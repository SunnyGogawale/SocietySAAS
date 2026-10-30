const PDFDocument = require('pdfkit');
const mongoose = require('mongoose');
const { AppError } = require('../utils/AppError');

const DAY_MS = 24 * 60 * 60 * 1000;

function roundHalfUp(numerator, denominator) {
  if (denominator <= 0n) throw new RangeError('The denominator must be positive');
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const rounded = quotient + (remainder * 2n >= denominator ? 1n : 0n);
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AppError(
      422,
      'amount_exceeds_limit',
      'The calculated amount exceeds the supported limit',
    );
  }
  return Number(rounded);
}

function scaledDecimal(value) {
  const text = String(value);
  const [whole, fraction = ''] = text.split('.');
  const scale = 10n ** BigInt(fraction.length);
  return { value: BigInt(`${whole}${fraction}`), scale };
}

function multiplyRateByArea(rateMinor, area, days, periodDays) {
  const decimal = scaledDecimal(area);
  return roundHalfUp(
    BigInt(rateMinor) * decimal.value * BigInt(days),
    decimal.scale * BigInt(periodDays),
  );
}

function dateOnly(value, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateOrdinal(value) {
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

function formatCurrency(minor, currency) {
  let digits;
  try {
    digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits;
  } catch {
    throw new AppError(422, 'unsupported_currency', 'The society currency is not supported');
  }
  return new Intl.NumberFormat('en', { style: 'currency', currency }).format(minor / 10 ** digits);
}

function periodKey(periodStart, periodEnd) {
  return `${periodStart.toISOString().slice(0, 10)}:${periodEnd.toISOString().slice(0, 10)}`;
}

function periodMonths(frequency) {
  return { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 }[frequency];
}

function validBillingPeriod(start, end, frequency) {
  const expected = new Date(
    Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth() + periodMonths(frequency),
      start.getUTCDate(),
    ),
  );
  expected.setUTCDate(expected.getUTCDate() - 1);
  return start.getUTCDate() === 1 && end.getTime() === expected.getTime();
}

function sumSafe(values) {
  const sum = values.reduce((total, value) => total + BigInt(value), 0n);
  if (sum > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AppError(
      422,
      'amount_exceeds_limit',
      'The calculated total exceeds the supported limit',
    );
  }
  return Number(sum);
}

function createBillingService({ models, audit, finance, clock = () => new Date() }) {
  const {
    BillItem,
    BillingReminder,
    BillingRun,
    ChargeRules,
    CreditNote,
    Flat,
    PaymentAllocation,
    MaintenanceBill,
    Ownership,
    Receipt,
    SocietySettings,
    SocietyMembership,
  } = models;

  function isAdmin(membership) {
    return membership?.role === 'society_admin';
  }

  async function getSettings(societyId) {
    return SocietySettings.findOne({ societyId }).lean();
  }

  async function activeOwnersForFlat(societyId, flatId) {
    const records = await Ownership.find({
      societyId,
      flatId,
      status: { $in: ['active', 'ended'] },
    }).lean();
    const ids = [...new Set(records.map(({ membershipId }) => String(membershipId)))];
    const memberships = await SocietyMembership.find({
      societyId,
      _id: { $in: ids },
      status: 'active',
      role: 'house_owner',
    }).lean();
    const byId = new Map(memberships.map((membership) => [String(membership._id), membership]));
    return records
      .filter((record) => byId.has(String(record.membershipId)))
      .map((record) => ({ ...record, membership: byId.get(String(record.membershipId)) }));
  }

  function ownershipCoverage(records, periodStart, periodEnd, timeZone) {
    const startKey = periodStart.toISOString().slice(0, 10);
    const endKey = periodEnd.toISOString().slice(0, 10);
    const startOrdinal = dateOrdinal(startKey);
    const endOrdinal = dateOrdinal(endKey);
    const ranges = records
      .map((record) => {
        const from = Math.max(startOrdinal, dateOrdinal(dateOnly(record.startsAt, timeZone)));
        const to = Math.min(
          endOrdinal,
          record.endsAt ? dateOrdinal(dateOnly(record.endsAt, timeZone)) : endOrdinal,
        );
        return from <= to ? [from, to] : null;
      })
      .filter(Boolean)
      .sort((left, right) => left[0] - right[0]);
    let days = 0;
    let current = null;
    for (const range of ranges) {
      if (!current) current = [...range];
      else if (range[0] <= current[1] + 1) current[1] = Math.max(current[1], range[1]);
      else {
        days += current[1] - current[0] + 1;
        current = [...range];
      }
    }
    if (current) days += current[1] - current[0] + 1;
    return {
      days,
      ownerMembershipIds: [
        ...new Set(
          records
            .filter((record) => {
              const from = dateOrdinal(dateOnly(record.startsAt, timeZone));
              const to = record.endsAt
                ? dateOrdinal(dateOnly(record.endsAt, timeZone))
                : endOrdinal;
              return from <= endOrdinal && to >= startOrdinal;
            })
            .map(({ membershipId }) => String(membershipId)),
        ),
      ],
    };
  }

  async function getBillBalances(bills) {
    if (!bills.length) return new Map();
    const ids = bills.map(({ _id }) => _id);
    const [notes, receipts, reversals] = await Promise.all([
      CreditNote.find({
        societyId: bills[0].societyId,
        status: 'issued',
        $or: [{ billId: { $in: ids } }, { 'allocations.billId': { $in: ids } }],
      }).lean(),
      Receipt.find({ societyId: bills[0].societyId, 'allocations.billId': { $in: ids } }).lean(),
      PaymentAllocation.find({
        societyId: bills[0].societyId,
        billId: { $in: ids },
        kind: { $in: ['refund', 'reversal'] },
      }).lean(),
    ]);
    const noteTotals = new Map();
    const principalNoteTotals = new Map();
    for (const note of notes) {
      const allocations = note.allocations?.length
        ? note.allocations
        : [{ billId: note.billId, amountMinor: note.amountMinor }];
      for (const allocation of allocations) {
        const key = String(allocation.billId);
        const sign = note.direction === 'debit' ? 1 : -1;
        noteTotals.set(key, (noteTotals.get(key) ?? 0) + sign * allocation.amountMinor);
        if (note.category !== 'late_fee' && note.category !== 'penalty') {
          principalNoteTotals.set(
            key,
            (principalNoteTotals.get(key) ?? 0) + sign * allocation.amountMinor,
          );
        }
      }
    }
    const paidByBill = new Map();
    for (const receipt of receipts) {
      for (const allocation of receipt.allocations) {
        const key = String(allocation.billId);
        paidByBill.set(key, (paidByBill.get(key) ?? 0) + allocation.amountMinor);
      }
    }
    for (const reversal of reversals) {
      const key = String(reversal.billId);
      paidByBill.set(key, (paidByBill.get(key) ?? 0) - reversal.amountMinor);
    }
    return new Map(
      bills.map((bill) => {
        const noteTotal = noteTotals.get(String(bill._id)) ?? 0;
        const principalAdjustments = principalNoteTotals.get(String(bill._id)) ?? 0;
        const paid = Math.max(0, paidByBill.get(String(bill._id)) ?? 0);
        const totalMinor = Math.max(0, bill.totalMinor + noteTotal);
        const outstandingMinor = Math.max(0, totalMinor - paid);
        const principalMinor = Math.max(0, bill.totalMinor + principalAdjustments - paid);
        return [
          String(bill._id),
          { totalMinor, paidMinor: paid, outstandingMinor, principalMinor },
        ];
      }),
    );
  }

  async function billPayloads(bills, { includeOwner = false } = {}) {
    const balances = await getBillBalances(bills);
    const flatIds = [...new Set(bills.map(({ flatId }) => String(flatId)))];
    const flats = await Flat.find({ _id: { $in: flatIds } })
      .select('flatNumber buildingId')
      .lean();
    const flatById = new Map(flats.map((flat) => [String(flat._id), flat]));
    const items = await BillItem.find({
      societyId: bills[0]?.societyId,
      billId: { $in: bills.map(({ _id }) => _id) },
    }).lean();
    const itemsByBill = new Map();
    for (const item of items) {
      const list = itemsByBill.get(String(item.billId)) ?? [];
      list.push(item);
      itemsByBill.set(String(item.billId), list);
    }
    return bills.map((bill) => ({
      id: String(bill._id),
      invoiceNumber: bill.invoiceNumber,
      flatId: String(bill.flatId),
      flat: flatById.get(String(bill.flatId))
        ? {
            id: String(bill.flatId),
            flatNumber: flatById.get(String(bill.flatId)).flatNumber,
          }
        : null,
      periodStart: bill.periodStart,
      periodEnd: bill.periodEnd,
      dueDate: bill.dueDate,
      revision: bill.revision,
      source: bill.source,
      status: bill.status,
      currency: bill.currency,
      subtotalMinor: bill.subtotalMinor,
      discountMinor: bill.discountMinor,
      totalMinor: bill.totalMinor,
      outstandingMinor: balances.get(String(bill._id))?.outstandingMinor ?? bill.totalMinor,
      paidMinor: balances.get(String(bill._id))?.paidMinor ?? 0,
      items: itemsByBill.get(String(bill._id)) ?? [],
      ...(includeOwner ? { ownerMembershipIds: bill.ownerMembershipIds } : {}),
      createdAt: bill.createdAt,
      issuedAt: bill.issuedAt,
    }));
  }

  async function applyUnappliedCreditsToBill({ society, bill, actor, request }) {
    const [credits, noteCredits] = await Promise.all([
      Receipt.find({
        societyId: society._id,
        flatId: bill.flatId,
        unappliedMinor: { $gt: 0 },
      })
        .sort({ receivedAt: 1, createdAt: 1, _id: 1 })
        .lean(),
      CreditNote.find({
        societyId: society._id,
        flatId: bill.flatId,
        direction: 'credit',
        status: 'issued',
        unappliedMinor: { $gt: 0 },
      })
        .sort({ createdAt: 1, _id: 1 })
        .lean(),
    ]);
    if (!credits.length && !noteCredits.length) return 0;
    let appliedMinor = 0;
    const openBills = await MaintenanceBill.find({
      societyId: society._id,
      flatId: bill.flatId,
      status: 'issued',
    })
      .sort({ issuedAt: 1, periodStart: 1, createdAt: 1 })
      .lean();
    const balances = await getBillBalances(openBills);
    for (const receipt of credits) {
      let creditRemaining = receipt.unappliedMinor;
      for (const target of openBills) {
        if (!creditRemaining) break;
        if (
          !target.ownerMembershipIds.some((id) => String(id) === String(receipt.payerMembershipId))
        ) {
          continue;
        }
        const outstanding = balances.get(String(target._id))?.outstandingMinor ?? 0;
        const applied = Math.min(creditRemaining, outstanding);
        if (!applied) continue;
        const result = await Receipt.updateOne(
          {
            societyId: society._id,
            _id: receipt._id,
            unappliedMinor: { $gte: applied },
          },
          {
            $inc: { unappliedMinor: -applied },
            $push: { allocations: { billId: target._id, amountMinor: applied } },
          },
        );
        if (!result.modifiedCount) break;
        await finance?.recordReceiptAllocation({
          society,
          actor,
          receipt,
          billId: target._id,
          amountMinor: applied,
        });
        creditRemaining -= applied;
        appliedMinor += applied;
        balances.set(String(target._id), {
          ...balances.get(String(target._id)),
          paidMinor: (balances.get(String(target._id))?.paidMinor ?? 0) + applied,
          outstandingMinor: outstanding - applied,
          principalMinor: Math.max(
            0,
            (balances.get(String(target._id))?.principalMinor ?? 0) - applied,
          ),
        });
        await audit.record({
          actorId: actor._id,
          societyId: society._id,
          action: 'billing.credit.auto_apply',
          targetType: 'receipt',
          targetId: receipt._id,
          outcome: 'success',
          requestId: request.id,
          metadata: { billId: target._id, amountMinor: applied },
        });
      }
    }
    for (const creditNote of noteCredits) {
      let creditRemaining = creditNote.unappliedMinor;
      for (const target of openBills) {
        if (!creditRemaining) break;
        if (
          !target.ownerMembershipIds.some((membershipId) =>
            creditNote.ownerMembershipIds.some(
              (creditOwnerId) => String(creditOwnerId) === String(membershipId),
            ),
          )
        ) {
          continue;
        }
        const outstanding = balances.get(String(target._id))?.outstandingMinor ?? 0;
        const applied = Math.min(creditRemaining, outstanding);
        if (!applied) continue;
        const result = await CreditNote.updateOne(
          {
            societyId: society._id,
            _id: creditNote._id,
            unappliedMinor: { $gte: applied },
          },
          {
            $inc: { unappliedMinor: -applied },
            $push: { allocations: { billId: target._id, amountMinor: applied } },
          },
        );
        if (!result.modifiedCount) break;
        creditRemaining -= applied;
        appliedMinor += applied;
        balances.set(String(target._id), {
          ...balances.get(String(target._id)),
          paidMinor: balances.get(String(target._id))?.paidMinor ?? 0,
          outstandingMinor: outstanding - applied,
          principalMinor: Math.max(
            0,
            (balances.get(String(target._id))?.principalMinor ?? 0) - applied,
          ),
        });
        await audit.record({
          actorId: actor._id,
          societyId: society._id,
          action: 'billing.credit_note.auto_apply',
          targetType: 'credit_note',
          targetId: creditNote._id,
          outcome: 'success',
          requestId: request.id,
          metadata: { billId: target._id, amountMinor: applied },
        });
      }
    }
    return appliedMinor;
  }

  async function createRecurringRun({ society, actor, data, request, source = 'recurring' }) {
    const settings = await getSettings(society._id);
    if (!settings)
      throw new AppError(422, 'society_settings_required', 'Configure society settings first');
    const periodStart = new Date(`${data.periodStart}T00:00:00.000Z`);
    const periodEnd = new Date(`${data.periodEnd}T00:00:00.000Z`);
    const chargeRules = await ChargeRules.findOne({
      societyId: society._id,
      effectiveFrom: { $lte: periodStart },
    })
      .sort({ effectiveFrom: -1, version: -1 })
      .lean();
    if (!chargeRules) {
      throw new AppError(
        422,
        'charge_rules_not_configured',
        'No charge rules cover the selected period',
      );
    }
    if (!validBillingPeriod(periodStart, periodEnd, chargeRules.frequency)) {
      throw new AppError(
        422,
        'invalid_billing_period',
        'The selected dates do not form one complete configured billing period',
      );
    }
    if (chargeRules.lateFee?.type === 'fixed') {
      throw new AppError(
        422,
        'late_fee_policy_incompatible',
        'Update the charge rules to use a monthly percentage late-fee rate and maximum cap',
      );
    }
    if (
      chargeRules.charges.some(({ calculation }) => calculation === 'per_area') &&
      (!settings.areaUnit || chargeRules.areaUnit !== settings.areaUnit)
    ) {
      throw new AppError(
        422,
        'area_unit_mismatch',
        'Society settings and per-area charge rules must use the same configured area unit',
      );
    }

    const periodDays =
      dateOrdinal(periodEnd.toISOString().slice(0, 10)) -
      dateOrdinal(periodStart.toISOString().slice(0, 10)) +
      1;
    const flats = await Flat.find({ societyId: society._id, status: 'active' }).lean();
    if (!flats.length)
      throw new AppError(422, 'no_eligible_flats', 'No active flats are available to bill');
    const ownerRecords = await Ownership.find({
      societyId: society._id,
      flatId: { $in: flats.map(({ _id }) => _id) },
      status: { $in: ['active', 'ended'] },
      startsAt: { $lte: periodEnd },
      $or: [{ endsAt: null }, { endsAt: { $gte: periodStart } }],
    }).lean();
    const activeMembershipIds = [
      ...new Set(ownerRecords.map(({ membershipId }) => String(membershipId))),
    ];
    const activeMemberships = await SocietyMembership.find({
      societyId: society._id,
      _id: { $in: activeMembershipIds },
      role: 'house_owner',
      status: 'active',
    })
      .select('_id')
      .lean();
    const activeSet = new Set(activeMemberships.map(({ _id }) => String(_id)));
    const ownersByFlat = new Map();
    for (const owner of ownerRecords) {
      if (!activeSet.has(String(owner.membershipId))) continue;
      const list = ownersByFlat.get(String(owner.flatId)) ?? [];
      list.push(owner);
      ownersByFlat.set(String(owner.flatId), list);
    }

    const key = periodKey(periodStart, periodEnd);
    const duplicateIds = await MaintenanceBill.find({
      societyId: society._id,
      flatId: { $in: flats.map(({ _id }) => _id) },
      activePeriodKey: key,
    }).distinct('flatId');
    if (duplicateIds.length) {
      throw new AppError(
        409,
        'bills_already_exist',
        'Bills already exist for one or more flats in this period; cancel an unpaid bill before creating an explicit revision',
        { flatIds: duplicateIds.map(String) },
      );
    }

    const revision =
      (
        await BillingRun.findOne({
          societyId: society._id,
          periodStart,
          periodEnd,
        })
          .sort({ revision: -1 })
          .select('revision')
          .lean()
      )?.revision + 1 || 1;
    const billsToCreate = [];
    const itemGroups = [];
    const skipped = [];
    const incompatibleAreaFlatIds = [];
    for (const flat of flats) {
      const ownerSet = ownersByFlat.get(String(flat._id)) ?? [];
      const coverage = ownershipCoverage(ownerSet, periodStart, periodEnd, settings.timeZone);
      if (!coverage.days) {
        skipped.push({ flatId: flat._id, reason: 'no_active_owner_during_period' });
        continue;
      }
      if (
        chargeRules.charges.some(({ calculation }) => calculation === 'per_area') &&
        flat.areaUnit !== settings.areaUnit
      ) {
        incompatibleAreaFlatIds.push(String(flat._id));
        continue;
      }
      const lineItems = [];
      for (const charge of chargeRules.charges) {
        const amountMinor =
          charge.calculation === 'per_area'
            ? multiplyRateByArea(charge.amountMinor, flat.area, coverage.days, periodDays)
            : roundHalfUp(BigInt(charge.amountMinor) * BigInt(coverage.days), BigInt(periodDays));
        lineItems.push({
          societyId: society._id,
          code: charge.code,
          description: charge.name,
          category: 'maintenance',
          calculation: charge.calculation,
          rateMinor: charge.amountMinor,
          quantity: charge.calculation === 'per_area' ? flat.area : coverage.days / periodDays,
          amountMinor,
          discount: false,
        });
      }
      const subtotalMinor = sumSafe(lineItems.map(({ amountMinor }) => amountMinor));
      for (const discount of chargeRules.discounts ?? []) {
        const amountMinor =
          discount.calculation === 'percentage'
            ? roundHalfUp(BigInt(subtotalMinor) * BigInt(discount.rateBasisPoints), 10000n)
            : Math.min(discount.amountMinor, subtotalMinor);
        if (amountMinor) {
          lineItems.push({
            societyId: society._id,
            code: discount.code,
            description: discount.name,
            category: 'discount',
            calculation: discount.calculation === 'percentage' ? 'manual' : 'fixed_per_home',
            rateMinor: discount.amountMinor ?? discount.rateBasisPoints,
            quantity: 1,
            amountMinor,
            discount: true,
            reason: 'Configured recurring discount',
          });
        }
      }
      const discountMinor = sumSafe(
        lineItems.filter(({ discount }) => discount).map(({ amountMinor }) => amountMinor),
      );
      const totalMinor = Math.max(0, subtotalMinor - discountMinor);
      const monthDue = new Date(
        Date.UTC(
          periodStart.getUTCFullYear(),
          periodStart.getUTCMonth(),
          chargeRules.dueDayOfPeriod,
        ),
      );
      const bill = {
        societyId: society._id,
        flatId: flat._id,
        periodStart,
        periodEnd,
        dueDate: monthDue,
        revision,
        source: source === 'revision' ? 'revision' : 'recurring',
        status: 'draft',
        activePeriodKey: key,
        currency: settings.currency,
        chargeRulesId: chargeRules._id,
        chargeRuleVersion: chargeRules.version,
        calculationSnapshot: {
          flatArea: flat.area,
          flatAreaUnit: flat.areaUnit,
          ownershipDays: coverage.days,
          periodDays,
          ownerMembershipIds: coverage.ownerMembershipIds,
          chargeRules: {
            frequency: chargeRules.frequency,
            version: chargeRules.version,
            charges: chargeRules.charges,
            discounts: chargeRules.discounts ?? [],
            lateFee: chargeRules.lateFee,
            gracePeriodDays: chargeRules.gracePeriodDays,
          },
        },
        ownerMembershipIds: coverage.ownerMembershipIds,
        subtotalMinor,
        discountMinor,
        totalMinor,
        createdBy: actor._id,
      };
      billsToCreate.push(bill);
      itemGroups.push(lineItems);
    }
    if (incompatibleAreaFlatIds.length) {
      throw new AppError(
        422,
        'flat_area_unit_mismatch',
        'All billable flats must use the configured society area unit',
        { flatIds: incompatibleAreaFlatIds },
      );
    }
    if (!billsToCreate.length) {
      throw new AppError(
        422,
        'no_eligible_flats',
        'No active owner-linked flats qualify for this period',
      );
    }
    let run;
    let createdBills = [];
    try {
      run = await BillingRun.create({
        societyId: society._id,
        periodStart,
        periodEnd,
        revision,
        source,
        status: 'draft',
        chargeRulesId: chargeRules._id,
        chargeRuleVersion: chargeRules.version,
        currency: settings.currency,
        createdBy: actor._id,
        preview: {
          flatCount: flats.length,
          billCount: billsToCreate.length,
          skippedFlatCount: skipped.length,
          subtotalMinor: sumSafe(billsToCreate.map(({ subtotalMinor }) => subtotalMinor)),
          discountMinor: sumSafe(billsToCreate.map(({ discountMinor }) => discountMinor)),
          totalMinor: sumSafe(billsToCreate.map(({ totalMinor }) => totalMinor)),
          skipped,
        },
      });
      createdBills = await MaintenanceBill.insertMany(
        billsToCreate.map((bill) => ({ ...bill, billingRunId: run._id })),
        { ordered: true },
      );
      const itemsToCreate = [];
      createdBills.forEach((bill, index) => {
        for (const item of itemGroups[index]) {
          itemsToCreate.push({ ...item, billId: bill._id });
        }
      });
      await BillItem.insertMany(itemsToCreate, { ordered: true });
      run.billIds = createdBills.map(({ _id }) => _id);
      await run.save();
    } catch (error) {
      if (createdBills.length) {
        await BillItem.deleteMany({
          societyId: society._id,
          billId: { $in: createdBills.map(({ _id }) => _id) },
        });
        await MaintenanceBill.deleteMany({
          societyId: society._id,
          _id: { $in: createdBills.map(({ _id }) => _id) },
        });
      }
      if (run?._id) await BillingRun.deleteOne({ societyId: society._id, _id: run._id });
      if (error?.code === 11000) {
        throw new AppError(
          409,
          'billing_run_conflict',
          'Another billing run was created for this period',
        );
      }
      throw error;
    }
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'billing.run.preview',
      targetType: 'billing_run',
      targetId: run._id,
      outcome: 'success',
      requestId: request.id,
      metadata: {
        periodStart,
        periodEnd,
        billCount: createdBills.length,
        totalMinor: run.preview.totalMinor,
        chargeRuleVersion: chargeRules.version,
      },
    });
    return { run: run.toObject(), bills: await billPayloads(createdBills) };
  }

  async function updateRunStatus({ society, actor, runId, action, request }) {
    const run = await BillingRun.findOne({ societyId: society._id, _id: runId });
    if (!run) throw new AppError(404, 'billing_run_not_found', 'Billing run was not found');
    const transitions = {
      review: ['draft', 'in_review'],
      approve: ['in_review', 'approved'],
      issue: ['approved', 'issued'],
    };
    const [from, to] = transitions[action] ?? [];
    if (run.status !== from) {
      throw new AppError(
        409,
        'invalid_billing_transition',
        `A ${run.status} run cannot be ${action}d`,
      );
    }
    const now = clock();
    if (action === 'issue') {
      const bills = await MaintenanceBill.find({
        societyId: society._id,
        _id: { $in: run.billIds },
        status: 'approved',
      });
      if (bills.length !== run.billIds.length) {
        throw new AppError(
          409,
          'billing_run_incomplete',
          'All bills must be approved before issue',
        );
      }
      for (const bill of bills) {
        bill.status = 'issued';
        bill.invoiceNumber ??= `INV-${bill.periodStart.toISOString().slice(0, 10).replaceAll('-', '')}-${String(bill._id).slice(-8).toUpperCase()}`;
        bill.issuedBy = actor._id;
        bill.issuedAt = now;
      }
      await Promise.all(bills.map((bill) => bill.save()));
      for (const bill of bills) {
        await finance?.postBillIssue({ society, actor, bill });
        await applyUnappliedCreditsToBill({ society, bill, actor, request });
        for (const membershipId of bill.ownerMembershipIds) {
          await BillingReminder.updateOne(
            {
              societyId: society._id,
              billId: bill._id,
              membershipId,
              kind: 'issued',
              reminderDateKey: now.toISOString().slice(0, 10),
            },
            {
              $setOnInsert: {
                societyId: society._id,
                billId: bill._id,
                membershipId,
                kind: 'issued',
                reminderDateKey: now.toISOString().slice(0, 10),
              },
            },
            { upsert: true },
          );
        }
      }
      run.issuedBy = actor._id;
      run.issuedAt = now;
    }
    run.status = to;
    if (action === 'review') {
      run.reviewedBy = actor._id;
      run.reviewedAt = now;
      await MaintenanceBill.updateMany(
        { societyId: society._id, _id: { $in: run.billIds }, status: 'draft' },
        { $set: { status: 'in_review', reviewedBy: actor._id, reviewedAt: now } },
      );
    } else if (action === 'approve') {
      run.approvedBy = actor._id;
      run.approvedAt = now;
      await MaintenanceBill.updateMany(
        { societyId: society._id, _id: { $in: run.billIds }, status: 'in_review' },
        { $set: { status: 'approved', approvedBy: actor._id, approvedAt: now } },
      );
    }
    await run.save();
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: `billing.run.${action}`,
      targetType: 'billing_run',
      targetId: run._id,
      outcome: 'success',
      requestId: request.id,
      metadata: {
        periodStart: run.periodStart,
        revision: run.revision,
        billCount: run.billIds.length,
      },
    });
    return run.toObject();
  }

  async function createStandaloneBill({ society, actor, data, request, source }) {
    const settings = await getSettings(society._id);
    if (!settings)
      throw new AppError(422, 'society_settings_required', 'Configure society settings first');
    const flat = await Flat.findOne({
      societyId: society._id,
      _id: data.flatId,
      status: 'active',
    }).lean();
    if (!flat) throw new AppError(404, 'flat_not_found', 'Flat was not found');
    const owners = await activeOwnersForFlat(society._id, flat._id);
    const ownerIds = [...new Set(owners.map(({ membershipId }) => String(membershipId)))];
    if (!ownerIds.length)
      throw new AppError(422, 'flat_has_no_active_owner', 'The flat has no active owner');
    const now = clock();
    const periodStart = data.periodStart
      ? new Date(`${data.periodStart}T00:00:00.000Z`)
      : new Date(`${dateOnly(now, settings.timeZone)}T00:00:00.000Z`);
    const periodEnd = data.periodEnd ? new Date(`${data.periodEnd}T00:00:00.000Z`) : periodStart;
    const dueDate = new Date(`${data.dueDate}T00:00:00.000Z`);
    const bill = await MaintenanceBill.create({
      societyId: society._id,
      flatId: flat._id,
      periodStart,
      periodEnd,
      dueDate,
      revision: 1,
      source,
      status: 'draft',
      currency: settings.currency,
      calculationSnapshot: {
        flatArea: flat.area,
        flatAreaUnit: flat.areaUnit,
        ownershipDays: 0,
        periodDays: 0,
        ownerMembershipIds: ownerIds,
      },
      ownerMembershipIds: ownerIds,
      subtotalMinor: data.amountMinor,
      discountMinor: 0,
      totalMinor: data.amountMinor,
      reason: data.reason,
      sourceReference: data.sourceReference ?? null,
      createdBy: actor._id,
    });
    try {
      await BillItem.create({
        societyId: society._id,
        billId: bill._id,
        code: source,
        description: data.description,
        category: source === 'opening_balance' ? 'opening_balance' : 'ad_hoc',
        calculation: source === 'opening_balance' ? 'opening_balance' : 'manual',
        rateMinor: data.amountMinor,
        quantity: 1,
        amountMinor: data.amountMinor,
        reason: data.reason,
      });
    } catch (error) {
      await MaintenanceBill.deleteOne({ societyId: society._id, _id: bill._id });
      throw error;
    }
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: `billing.${source}.create`,
      targetType: 'maintenance_bill',
      targetId: bill._id,
      outcome: 'success',
      requestId: request.id,
      metadata: { flatId: flat._id, amountMinor: data.amountMinor, currency: settings.currency },
    });
    return (await billPayloads([bill]))[0];
  }

  async function importOpeningBalances({ society, actor, data, request }) {
    const settings = await getSettings(society._id);
    if (!settings)
      throw new AppError(422, 'society_settings_required', 'Configure society settings first');
    const flats = await Flat.find({
      societyId: society._id,
      _id: { $in: data.rows.map(({ flatId }) => flatId) },
      status: 'active',
    }).lean();
    const flatById = new Map(flats.map((flat) => [String(flat._id), flat]));
    const errors = [];
    const ownerIdsByFlat = new Map();
    for (const [index, row] of data.rows.entries()) {
      const flat = flatById.get(String(row.flatId));
      if (!flat) {
        errors.push({ row: index + 1, code: 'flat_not_found' });
        continue;
      }
      const owners = await activeOwnersForFlat(society._id, flat._id);
      const ownerIds = [...new Set(owners.map(({ membershipId }) => String(membershipId)))];
      if (!ownerIds.length) errors.push({ row: index + 1, code: 'flat_has_no_active_owner' });
      ownerIdsByFlat.set(String(row.flatId), ownerIds);
    }
    if (errors.length) {
      throw new AppError(
        422,
        'opening_balance_import_invalid',
        'One or more opening balances could not be linked to an active flat owner',
        { rows: errors },
      );
    }
    const billsToCreate = data.rows.map((row) => {
      const flat = flatById.get(String(row.flatId));
      const dueDate = new Date(`${row.dueDate}T00:00:00.000Z`);
      const ownerMembershipIds = ownerIdsByFlat.get(String(row.flatId));
      return {
        societyId: society._id,
        flatId: flat._id,
        periodStart: dueDate,
        periodEnd: dueDate,
        dueDate,
        revision: 1,
        source: 'opening_balance',
        status: 'draft',
        currency: settings.currency,
        calculationSnapshot: {
          flatArea: flat.area,
          flatAreaUnit: flat.areaUnit,
          ownershipDays: 0,
          periodDays: 0,
          ownerMembershipIds,
          chargeRules: {
            sourceReference: data.sourceReference,
            sourceTotalMinor: data.sourceTotalMinor,
            verifiedBy: String(actor._id),
            verifiedAt: clock(),
          },
        },
        ownerMembershipIds,
        subtotalMinor: row.amountMinor,
        discountMinor: 0,
        totalMinor: row.amountMinor,
        reason: row.reason,
        sourceReference: data.sourceReference,
        createdBy: actor._id,
      };
    });
    let bills = [];
    try {
      bills = await MaintenanceBill.insertMany(billsToCreate, { ordered: true });
      const items = bills.map((bill, index) => {
        const row = data.rows[index];
        return {
          societyId: society._id,
          billId: bill._id,
          code: 'opening_balance',
          description: row.description,
          category: 'opening_balance',
          calculation: 'opening_balance',
          rateMinor: row.amountMinor,
          quantity: 1,
          amountMinor: row.amountMinor,
          reason: row.reason,
        };
      });
      await BillItem.insertMany(items, { ordered: true });
    } catch (error) {
      if (bills.length) {
        await BillItem.deleteMany({
          societyId: society._id,
          billId: { $in: bills.map(({ _id }) => _id) },
        });
        await MaintenanceBill.deleteMany({
          societyId: society._id,
          _id: { $in: bills.map(({ _id }) => _id) },
        });
      }
      if (error?.code === 11000) {
        throw new AppError(
          409,
          'opening_balance_duplicate',
          'An opening balance already exists for a flat in this source batch',
        );
      }
      throw error;
    }
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'billing.opening_balance.import',
      targetType: 'opening_balance_batch',
      outcome: 'success',
      requestId: request.id,
      metadata: {
        sourceReference: data.sourceReference,
        rows: bills.length,
        reconciledTotalMinor: sumSafe(data.rows.map(({ amountMinor }) => amountMinor)),
        sourceTotalMinor: data.sourceTotalMinor,
      },
    });
    return {
      bills: await billPayloads(bills),
      sourceReference: data.sourceReference,
      reconciledTotalMinor: data.sourceTotalMinor,
    };
  }

  async function updateBillStatus({ society, actor, billId, action, request }) {
    const bill = await MaintenanceBill.findOne({ societyId: society._id, _id: billId });
    if (!bill) throw new AppError(404, 'bill_not_found', 'Bill was not found');
    const transitions = {
      review: ['draft', 'in_review'],
      approve: ['in_review', 'approved'],
      issue: ['approved', 'issued'],
    };
    const [from, to] = transitions[action] ?? [];
    if (bill.status !== from) {
      throw new AppError(
        409,
        'invalid_bill_transition',
        `A ${bill.status} bill cannot be ${action}d`,
      );
    }
    const now = clock();
    bill.status = to;
    if (action === 'review') {
      bill.reviewedBy = actor._id;
      bill.reviewedAt = now;
    } else if (action === 'approve') {
      bill.approvedBy = actor._id;
      bill.approvedAt = now;
    } else {
      bill.issuedBy = actor._id;
      bill.issuedAt = now;
      bill.invoiceNumber ??= `INV-${bill.periodStart.toISOString().slice(0, 10).replaceAll('-', '')}-${String(bill._id).slice(-8).toUpperCase()}`;
      const dateKey = now.toISOString().slice(0, 10);
      for (const membershipId of bill.ownerMembershipIds) {
        await BillingReminder.updateOne(
          {
            societyId: society._id,
            billId: bill._id,
            membershipId,
            kind: 'issued',
            reminderDateKey: dateKey,
          },
          {
            $setOnInsert: {
              societyId: society._id,
              billId: bill._id,
              membershipId,
              kind: 'issued',
              reminderDateKey: dateKey,
            },
          },
          { upsert: true },
        );
      }
    }
    await bill.save();
    if (action === 'issue') {
      await finance?.postBillIssue({ society, actor, bill });
      await applyUnappliedCreditsToBill({ society, bill, actor, request });
    }
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: `billing.bill.${action}`,
      targetType: 'maintenance_bill',
      targetId: bill._id,
      outcome: 'success',
      requestId: request.id,
      metadata: { invoiceNumber: bill.invoiceNumber, status: bill.status },
    });
    return (await billPayloads([bill]))[0];
  }

  async function cancelBill({ society, actor, billId, reason, request }) {
    const bill = await MaintenanceBill.findOne({
      societyId: society._id,
      _id: billId,
      status: { $in: ['draft', 'in_review', 'approved', 'issued'] },
    });
    if (!bill) throw new AppError(404, 'bill_not_found', 'Bill was not found');
    const [receipt, note] = await Promise.all([
      Receipt.exists({ societyId: society._id, 'allocations.billId': bill._id }),
      CreditNote.exists({
        societyId: society._id,
        status: 'issued',
        $or: [{ billId: bill._id }, { 'allocations.billId': bill._id }],
      }),
    ]);
    if (receipt || note) {
      throw new AppError(
        409,
        'bill_has_financial_activity',
        'A bill with payments or adjustments cannot be cancelled; create an authorized credit or debit note',
      );
    }
    bill.status = 'cancelled';
    bill.activePeriodKey = null;
    bill.cancelledBy = actor._id;
    bill.cancelledAt = clock();
    bill.cancellationReason = reason;
    await bill.save();
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'billing.bill.cancel',
      targetType: 'maintenance_bill',
      targetId: bill._id,
      outcome: 'success',
      requestId: request.id,
      metadata: { invoiceNumber: bill.invoiceNumber, reason },
    });
    return { id: String(bill._id), status: bill.status, cancellationReason: reason };
  }

  async function createRevision({ society, actor, billId, data, request }) {
    const previous = await MaintenanceBill.findOne({
      societyId: society._id,
      _id: billId,
      status: 'cancelled',
      source: { $in: ['recurring', 'revision'] },
    }).lean();
    if (!previous)
      throw new AppError(
        409,
        'bill_not_revisable',
        'Only a cancelled unpaid recurring bill can be revised',
      );
    const items =
      data.items ?? (await BillItem.find({ societyId: society._id, billId: previous._id }).lean());
    const subtotalMinor = sumSafe(
      items.filter(({ discount }) => !discount).map(({ amountMinor }) => amountMinor),
    );
    const discountMinor = sumSafe(
      items.filter(({ discount }) => discount).map(({ amountMinor }) => amountMinor),
    );
    if (discountMinor > subtotalMinor) {
      throw new AppError(
        422,
        'discount_exceeds_charges',
        'Discounts cannot exceed the charge subtotal',
      );
    }
    const bill = await MaintenanceBill.create({
      ...previous,
      _id: undefined,
      status: 'draft',
      revision: previous.revision + 1,
      source: 'revision',
      activePeriodKey: periodKey(previous.periodStart, previous.periodEnd),
      invoiceNumber: null,
      subtotalMinor,
      discountMinor,
      totalMinor: subtotalMinor - discountMinor,
      reason: data.reason,
      createdBy: actor._id,
      reviewedBy: null,
      reviewedAt: null,
      approvedBy: null,
      approvedAt: null,
      issuedBy: null,
      issuedAt: null,
      cancelledBy: null,
      cancelledAt: null,
      cancellationReason: null,
    });
    await BillItem.insertMany(
      items.map((item) => ({
        societyId: society._id,
        billId: bill._id,
        code: item.code,
        description: item.description,
        category: item.category,
        calculation: item.calculation,
        rateMinor: item.rateMinor,
        quantity: item.quantity,
        amountMinor: item.amountMinor,
        discount: item.discount,
        reason: item.reason,
      })),
    );
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'billing.bill.revise',
      targetType: 'maintenance_bill',
      targetId: bill._id,
      outcome: 'success',
      requestId: request.id,
      metadata: { previousBillId: previous._id, revision: bill.revision, reason: data.reason },
    });
    return (await billPayloads([bill]))[0];
  }

  async function createCreditNote({ society, actor, billId, data, request }) {
    const bill = await MaintenanceBill.findOne({
      societyId: society._id,
      _id: billId,
      status: 'issued',
    });
    if (!bill) throw new AppError(404, 'bill_not_found', 'Issued bill was not found');
    const note = await CreditNote.create({
      societyId: society._id,
      billId: bill._id,
      flatId: bill.flatId,
      ownerMembershipIds: bill.ownerMembershipIds,
      direction: data.direction,
      category: data.category,
      amountMinor: data.amountMinor,
      currency: bill.currency,
      reason: data.reason,
      status: 'pending_approval',
      createdBy: actor._id,
    });
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'billing.adjustment.create',
      targetType: 'credit_note',
      targetId: note._id,
      outcome: 'success',
      requestId: request.id,
      metadata: {
        billId: bill._id,
        direction: note.direction,
        category: note.category,
        amountMinor: note.amountMinor,
      },
    });
    return note.toObject();
  }

  async function updateCreditNote({ society, actor, noteId, action, request }) {
    const note = await CreditNote.findOne({ societyId: society._id, _id: noteId });
    if (!note) throw new AppError(404, 'adjustment_not_found', 'Adjustment was not found');
    const transitions = {
      approve: ['pending_approval', 'approved'],
      issue: ['approved', 'issued'],
    };
    const [from, to] = transitions[action] ?? [];
    if (note.status !== from)
      throw new AppError(
        409,
        'invalid_adjustment_transition',
        'The adjustment is not in the required state',
      );
    note.status = to;
    if (action === 'approve') {
      note.approvedBy = actor._id;
      note.approvedAt = clock();
    } else {
      note.issuedBy = actor._id;
      note.issuedAt = clock();
      note.noteNumber ??= `ADJ-${String(note._id).slice(-10).toUpperCase()}`;
      if (note.direction === 'credit') {
        const bill = await MaintenanceBill.findOne({
          societyId: society._id,
          _id: note.billId,
          status: 'issued',
        }).lean();
        if (!bill)
          throw new AppError(409, 'bill_not_issued', 'The adjustment bill is no longer issued');
        const balances = await getBillBalances([bill]);
        const appliedMinor = Math.min(
          note.amountMinor,
          balances.get(String(bill._id))?.outstandingMinor ?? 0,
        );
        note.allocations = appliedMinor ? [{ billId: bill._id, amountMinor: appliedMinor }] : [];
        note.unappliedMinor = note.amountMinor - appliedMinor;
      } else {
        note.allocations = [{ billId: note.billId, amountMinor: note.amountMinor }];
        note.unappliedMinor = 0;
      }
    }
    await note.save();
    if (action === 'issue') await finance?.postCreditNote({ society, actor, note });
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: `billing.adjustment.${action}`,
      targetType: 'credit_note',
      targetId: note._id,
      outcome: 'success',
      requestId: request.id,
      metadata: { billId: note.billId, amountMinor: note.amountMinor, direction: note.direction },
    });
    return note.toObject();
  }

  async function createReceipt({ society, actor, data, request }) {
    const flat = await Flat.findOne({
      societyId: society._id,
      _id: data.flatId,
      status: 'active',
    }).lean();
    if (!flat) throw new AppError(404, 'flat_not_found', 'Flat was not found');
    const settings = await getSettings(society._id);
    const payer = await SocietyMembership.findOne({
      societyId: society._id,
      _id: data.payerMembershipId,
      role: 'house_owner',
      status: 'active',
    }).lean();
    if (
      !payer ||
      !(await Ownership.exists({
        societyId: society._id,
        flatId: flat._id,
        membershipId: payer._id,
        status: 'active',
      }))
    ) {
      throw new AppError(422, 'payer_not_linked', 'The payer must be an active owner of this flat');
    }
    const bills = await MaintenanceBill.find({
      societyId: society._id,
      flatId: flat._id,
      status: 'issued',
    })
      .sort({ issuedAt: 1, periodStart: 1, createdAt: 1 })
      .lean();
    const balances = await getBillBalances(bills);
    const eligible = bills.filter(
      (bill) =>
        bill.ownerMembershipIds.some((id) => String(id) === String(payer._id)) &&
        (balances.get(String(bill._id))?.outstandingMinor ?? 0) > 0,
    );
    let allocations;
    let allocationMode;
    if (data.allocations?.length) {
      const billMap = new Map(eligible.map((bill) => [String(bill._id), bill]));
      allocations = data.allocations.map(({ billId, amountMinor }) => {
        const bill = billMap.get(String(billId));
        if (!bill || !bill.ownerMembershipIds.some((id) => String(id) === String(payer._id))) {
          throw new AppError(
            422,
            'invalid_receipt_allocation',
            'Manual allocations must target an unpaid bill for this flat and owner',
          );
        }
        if (amountMinor > balances.get(String(bill._id)).outstandingMinor) {
          throw new AppError(
            422,
            'allocation_exceeds_balance',
            'An allocation exceeds the bill outstanding balance',
          );
        }
        return { billId: bill._id, amountMinor };
      });
      allocationMode = 'manual';
    } else {
      let remaining = data.amountMinor;
      allocations = [];
      for (const bill of eligible) {
        if (!remaining) break;
        const allocated = Math.min(remaining, balances.get(String(bill._id)).outstandingMinor);
        if (allocated) allocations.push({ billId: bill._id, amountMinor: allocated });
        remaining -= allocated;
      }
      allocationMode = 'fifo';
    }
    const allocatedMinor = sumSafe(allocations.map(({ amountMinor }) => amountMinor));
    if (allocatedMinor > data.amountMinor) {
      throw new AppError(
        422,
        'allocation_exceeds_receipt',
        'Allocations cannot exceed the received amount',
      );
    }
    const receipt = await Receipt.create({
      societyId: society._id,
      receiptNumber: `RCT-${clock().toISOString().slice(0, 10).replaceAll('-', '')}-${new mongoose.Types.ObjectId().toString().slice(-8).toUpperCase()}`,
      payerMembershipId: payer._id,
      flatId: flat._id,
      amountMinor: data.amountMinor,
      currency: settings.currency,
      receivedAt: data.receivedAt ? new Date(data.receivedAt) : clock(),
      method: data.method,
      reference: data.reference ?? null,
      allocations,
      unappliedMinor: data.amountMinor - allocatedMinor,
      receivedBy: actor._id,
      allocationMode,
      reason: data.reason ?? null,
    });
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'billing.receipt.create',
      targetType: 'receipt',
      targetId: receipt._id,
      outcome: 'success',
      requestId: request.id,
      metadata: {
        flatId: flat._id,
        amountMinor: receipt.amountMinor,
        allocatedMinor,
        mode: allocationMode,
      },
    });
    return receipt.toObject();
  }

  async function listBills({ society, membership, query }) {
    const filter = { societyId: society._id, status: { $ne: 'cancelled' } };
    if (!isAdmin(membership)) {
      filter.status = 'issued';
      filter.ownerMembershipIds = membership._id;
    } else if (query.status) filter.status = query.status;
    if (query.flatId && isAdmin(membership)) filter.flatId = query.flatId;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [bills, total] = await Promise.all([
      MaintenanceBill.find(filter)
        .sort({ periodStart: -1, createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      MaintenanceBill.countDocuments(filter),
    ]);
    return {
      bills: await billPayloads(bills),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async function getBill({ society, membership, billId }) {
    const filter = { societyId: society._id, _id: billId };
    if (!isAdmin(membership)) {
      filter.status = 'issued';
      filter.ownerMembershipIds = membership._id;
    }
    const bill = await MaintenanceBill.findOne(filter).lean();
    if (!bill) throw new AppError(404, 'bill_not_found', 'Bill was not found');
    const noteFilter = {
      societyId: society._id,
      status: isAdmin(membership) ? { $ne: 'cancelled' } : 'issued',
      $or: [{ billId: bill._id }, { 'allocations.billId': bill._id }],
    };
    const [base, notes, receipts, settings, allFlatBills] = await Promise.all([
      billPayloads([bill]),
      CreditNote.find(noteFilter).sort({ createdAt: 1 }).lean(),
      Receipt.find({ societyId: society._id, 'allocations.billId': bill._id })
        .sort({ receivedAt: 1 })
        .lean(),
      getSettings(society._id),
      MaintenanceBill.find({
        societyId: society._id,
        flatId: bill.flatId,
        status: 'issued',
      }).lean(),
    ]);
    const allBalances = await getBillBalances(allFlatBills);
    const accountOutstandingMinor = [...allBalances.values()].reduce(
      (sum, balance) => sum + balance.outstandingMinor,
      0,
    );
    const [unappliedReceipts, unappliedNotes] = await Promise.all([
      Receipt.find({
        societyId: society._id,
        flatId: bill.flatId,
        payerMembershipId: { $in: bill.ownerMembershipIds },
        unappliedMinor: { $gt: 0 },
      })
        .select('unappliedMinor')
        .lean(),
      CreditNote.find({
        societyId: society._id,
        flatId: bill.flatId,
        direction: 'credit',
        status: 'issued',
        ownerMembershipIds: { $in: bill.ownerMembershipIds },
        unappliedMinor: { $gt: 0 },
      })
        .select('unappliedMinor')
        .lean(),
    ]);
    const availableCreditMinor = sumSafe([
      ...unappliedReceipts.map(({ unappliedMinor }) => unappliedMinor),
      ...unappliedNotes.map(({ unappliedMinor }) => unappliedMinor),
    ]);
    return {
      ...base[0],
      accountOutstandingMinor,
      availableCreditMinor,
      calculationSnapshot: bill.calculationSnapshot,
      notes: notes.map((note) => ({ ...note, id: String(note._id) })),
      payments: receipts.map((receipt) => ({
        id: String(receipt._id),
        receiptNumber: receipt.receiptNumber,
        amountMinor: receipt.amountMinor,
        currency: receipt.currency,
        receivedAt: receipt.receivedAt,
        method: receipt.method,
        reference: receipt.reference,
        allocatedMinor: receipt.allocations
          .filter(({ billId: allocatedBillId }) => String(allocatedBillId) === String(bill._id))
          .reduce((sum, allocation) => sum + allocation.amountMinor, 0),
      })),
      currencyDisplay: formatCurrency(base[0].outstandingMinor, settings.currency),
    };
  }

  async function markReminderRead({ society, membership, reminderId }) {
    const reminder = await BillingReminder.findOneAndUpdate(
      { societyId: society._id, _id: reminderId, membershipId: membership._id },
      { $set: { readAt: clock() } },
      { returnDocument: 'after' },
    ).lean();
    if (!reminder) throw new AppError(404, 'reminder_not_found', 'Reminder was not found');
    return reminder;
  }

  async function getReminders({ society, membership }) {
    const reminders = await BillingReminder.find({
      societyId: society._id,
      membershipId: membership._id,
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    return reminders;
  }

  async function issueDueReminders({ society, actor, daysAhead, request }) {
    const today = new Date(
      `${dateOnly(clock(), (await getSettings(society._id)).timeZone)}T00:00:00.000Z`,
    );
    const end = new Date(today.getTime() + daysAhead * DAY_MS);
    const bills = await MaintenanceBill.find({
      societyId: society._id,
      status: 'issued',
      dueDate: { $lte: end },
    }).lean();
    const balances = await getBillBalances(bills);
    let created = 0;
    const dateKey = today.toISOString().slice(0, 10);
    for (const bill of bills) {
      const balance = balances.get(String(bill._id))?.outstandingMinor ?? 0;
      if (!balance) continue;
      const kind = bill.dueDate < today ? 'overdue' : 'due_soon';
      for (const membershipId of bill.ownerMembershipIds) {
        const result = await BillingReminder.updateOne(
          {
            societyId: society._id,
            billId: bill._id,
            membershipId,
            kind,
            reminderDateKey: dateKey,
          },
          {
            $setOnInsert: {
              societyId: society._id,
              billId: bill._id,
              membershipId,
              kind,
              reminderDateKey: dateKey,
            },
          },
          { upsert: true },
        );
        created += result.upsertedCount ?? 0;
      }
    }
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'billing.reminders.issue',
      targetType: 'billing_reminders',
      outcome: 'success',
      requestId: request.id,
      metadata: { created, daysAhead },
    });
    return { created, evaluatedBills: bills.length, date: dateKey };
  }

  async function assessMonthlyLateFees({ society, actor, request }) {
    const settings = await getSettings(society._id);
    const now = clock();
    const today = new Date(`${dateOnly(now, settings.timeZone)}T00:00:00.000Z`);
    const bills = await MaintenanceBill.find({ societyId: society._id, status: 'issued' }).lean();
    const balances = await getBillBalances(bills);
    let created = 0;
    for (const bill of bills) {
      const policy = bill.calculationSnapshot.chargeRules?.lateFee;
      if (policy?.type !== 'percentage' || !policy.rateBasisPoints || !policy.capAmountMinor)
        continue;
      const graceDays = bill.calculationSnapshot.chargeRules.gracePeriodDays ?? 0;
      const firstEligibleDate = new Date(bill.dueDate.getTime() + (graceDays + 1) * DAY_MS);
      if (today < firstEligibleDate) continue;
      const balance = balances.get(String(bill._id));
      if (!balance?.principalMinor) continue;
      const monthKey = dateOnly(today, settings.timeZone).slice(0, 7);
      const accrualKey = `${bill._id}:${monthKey}`;
      const priorLateFees = await CreditNote.aggregate([
        {
          $match: {
            societyId: bill.societyId,
            billId: bill._id,
            category: 'late_fee',
            status: 'issued',
          },
        },
        { $group: { _id: null, total: { $sum: '$amountMinor' } } },
      ]);
      const remainingCap = Math.max(0, policy.capAmountMinor - (priorLateFees[0]?.total ?? 0));
      if (!remainingCap) continue;
      const amountMinor = Math.min(
        remainingCap,
        roundHalfUp(BigInt(balance.principalMinor) * BigInt(policy.rateBasisPoints), 10000n),
      );
      if (!amountMinor) continue;
      const result = await CreditNote.updateOne(
        { societyId: society._id, accrualKey },
        {
          $setOnInsert: {
            societyId: society._id,
            billId: bill._id,
            flatId: bill.flatId,
            ownerMembershipIds: bill.ownerMembershipIds,
            direction: 'debit',
            category: 'late_fee',
            amountMinor,
            currency: bill.currency,
            reason: `Monthly late fee for ${monthKey} on overdue principal only`,
            accrualKey,
            status: 'issued',
            createdBy: actor._id,
            approvedBy: actor._id,
            approvedAt: now,
            issuedBy: actor._id,
            issuedAt: now,
            noteNumber: `FEE-${monthKey.replace('-', '')}-${String(bill._id).slice(-8).toUpperCase()}`,
          },
        },
        { upsert: true },
      );
      created += result.upsertedCount ?? 0;
      if (result.upsertedCount) {
        const note = await CreditNote.findOne({ societyId: society._id, accrualKey }).lean();
        if (note) await finance?.postCreditNote({ society, actor, note });
      }
    }
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'billing.late_fees.assess',
      targetType: 'credit_notes',
      outcome: 'success',
      requestId: request.id,
      metadata: {
        created,
        evaluatedBills: bills.length,
        month: dateOnly(today, settings.timeZone).slice(0, 7),
      },
    });
    return { created, evaluatedBills: bills.length };
  }

  async function getAgeingReport({ society, membership }) {
    const settings = await getSettings(society._id);
    const now = new Date(`${dateOnly(clock(), settings.timeZone)}T00:00:00.000Z`);
    let bills = await MaintenanceBill.find({ societyId: society._id, status: 'issued' }).lean();
    if (!isAdmin(membership)) {
      bills = bills.filter((bill) =>
        bill.ownerMembershipIds.some((id) => String(id) === String(membership._id)),
      );
    }
    const balances = await getBillBalances(bills);
    const ageing = { current: 0, days1To30: 0, days31To60: 0, days61To90: 0, over90Days: 0 };
    const items = [];
    for (const bill of bills) {
      const outstandingMinor = balances.get(String(bill._id))?.outstandingMinor ?? 0;
      if (!outstandingMinor) continue;
      const age = Math.max(0, Math.floor((now.getTime() - bill.dueDate.getTime()) / DAY_MS));
      if (bill.dueDate >= now) ageing.current += outstandingMinor;
      else if (age <= 30) ageing.days1To30 += outstandingMinor;
      else if (age <= 60) ageing.days31To60 += outstandingMinor;
      else if (age <= 90) ageing.days61To90 += outstandingMinor;
      else ageing.over90Days += outstandingMinor;
      items.push({
        billId: String(bill._id),
        flatId: String(bill.flatId),
        dueDate: bill.dueDate,
        outstandingMinor,
        ageDays: age,
      });
    }
    return {
      currency: settings.currency,
      ageing,
      totalOutstandingMinor: sumSafe(Object.values(ageing)),
      bills: items,
    };
  }

  async function listRuns({ society }) {
    return BillingRun.find({ societyId: society._id })
      .sort({ periodStart: -1, revision: -1 })
      .limit(50)
      .lean();
  }

  async function getBillPdf({ society, membership, billId, actor, request }) {
    const bill = await MaintenanceBill.findOne({
      societyId: society._id,
      _id: billId,
      status: 'issued',
      ...(isAdmin(membership) ? {} : { ownerMembershipIds: membership._id }),
    }).lean();
    if (!bill) throw new AppError(404, 'bill_not_found', 'Issued bill was not found');
    const detail = await getBill({ society, membership, billId });
    const pdf = new PDFDocument({
      size: 'A4',
      margin: 48,
      info: { Title: `Bill ${bill.invoiceNumber}` },
    });
    const chunks = [];
    const bufferPromise = new Promise((resolve, reject) => {
      pdf.on('data', (chunk) => chunks.push(chunk));
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);
    });
    pdf.fontSize(20).text('Maintenance bill', { align: 'center' });
    pdf.moveDown();
    pdf.fontSize(11).text(`Invoice: ${bill.invoiceNumber}`);
    pdf.text(`Society: ${society.name}`);
    pdf.text(`Flat: ${detail.flat?.flatNumber ?? String(bill.flatId)}`);
    pdf.text(
      `Billing period: ${dateOnly(bill.periodStart, 'UTC')} to ${dateOnly(bill.periodEnd, 'UTC')}`,
    );
    pdf.text(`Due date: ${dateOnly(bill.dueDate, 'UTC')}`);
    pdf.moveDown().fontSize(13).text('Charges');
    pdf.moveDown(0.5).fontSize(10);
    for (const item of detail.items) {
      const signedAmount = item.discount ? -item.amountMinor : item.amountMinor;
      pdf.text(`${item.description}  ${formatCurrency(signedAmount, bill.currency)}`);
    }
    pdf.moveDown().fontSize(11);
    pdf.text(`Subtotal: ${formatCurrency(bill.subtotalMinor, bill.currency)}`);
    if (bill.discountMinor)
      pdf.text(`Discounts: -${formatCurrency(bill.discountMinor, bill.currency)}`);
    pdf.text(`Bill total: ${formatCurrency(bill.totalMinor, bill.currency)}`);
    pdf.text(`Paid: ${formatCurrency(detail.paidMinor, bill.currency)}`);
    pdf.text(`Outstanding on this bill: ${formatCurrency(detail.outstandingMinor, bill.currency)}`);
    pdf.text(
      `Flat account outstanding: ${formatCurrency(detail.accountOutstandingMinor, bill.currency)}`,
    );
    if (detail.payments.length) {
      pdf.moveDown().fontSize(13).text('Payment history');
      pdf.moveDown(0.5).fontSize(10);
      for (const payment of detail.payments) {
        pdf.text(
          `${payment.receiptNumber} · ${dateOnly(payment.receivedAt, 'UTC')} · ${formatCurrency(payment.allocatedMinor, bill.currency)} · ${payment.method}`,
        );
      }
    }
    pdf.end();
    const buffer = await bufferPromise;
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'billing.bill.download',
      targetType: 'maintenance_bill',
      targetId: bill._id,
      outcome: 'success',
      requestId: request.id,
      metadata: { invoiceNumber: bill.invoiceNumber, format: 'pdf' },
    });
    return { buffer, filename: `${bill.invoiceNumber}.pdf` };
  }

  async function getRemindersForOwner({ society, membership }) {
    return getReminders({ society, membership });
  }

  return {
    assessMonthlyLateFees,
    cancelBill,
    createCreditNote,
    createReceipt,
    createRecurringRun,
    createRevision,
    createStandaloneBill,
    getAgeingReport,
    getBill,
    getBillPdf,
    getReminders: getRemindersForOwner,
    issueDueReminders,
    importOpeningBalances,
    listBills,
    listRuns,
    markReminderRead,
    updateBillStatus,
    updateCreditNote,
    updateRunStatus,
  };
}

module.exports = {
  createBillingService,
  multiplyRateByArea,
  roundHalfUp,
  validBillingPeriod,
};
