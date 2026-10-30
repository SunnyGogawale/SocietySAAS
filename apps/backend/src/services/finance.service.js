const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { AppError } = require('../utils/AppError');

const DEFAULT_ACCOUNTS = [
  ['1000', 'Bank', 'asset', 'debit', 'bank'],
  ['1005', 'Cash', 'asset', 'debit', 'cash'],
  ['1010', 'Gateway clearing', 'asset', 'debit', 'gateway_clearing'],
  ['1100', 'Accounts receivable', 'asset', 'debit', 'accounts_receivable'],
  ['2000', 'Accounts payable', 'liability', 'credit', 'accounts_payable'],
  ['2100', 'Resident advances', 'liability', 'credit', 'resident_advances'],
  ['4000', 'Maintenance income', 'income', 'credit', 'maintenance_income'],
  ['4010', 'Adjustments and credits', 'income', 'credit', 'adjustment_income'],
  ['4020', 'Late-fee income', 'income', 'credit', 'late_fee_income'],
  ['5000', 'General expense', 'expense', 'debit', 'general_expense'],
];

function createFinanceService({
  models,
  audit,
  config,
  fetchImpl = global.fetch,
  clock = () => new Date(),
}) {
  const {
    Account,
    ApprovalPolicies,
    BankStatementImport,
    BankStatementLine,
    CreditNote,
    Expense,
    GatewaySettlement,
    JournalEntry,
    JournalLine,
    MaintenanceBill,
    Payment,
    PaymentAllocation,
    PaymentGatewayAccount,
    PaymentWebhookEvent,
    Receipt,
    SocietySettings,
    Vendor,
  } = models;

  function encryptionKey() {
    const key = Buffer.from(config.paymentCredentialEncryptionKey ?? '', 'base64');
    if (key.length !== 32) {
      throw new AppError(
        503,
        'payment_credentials_unavailable',
        'Payment credential encryption is not configured',
      );
    }

    return key;
  }

  function encryptSecret(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64')).join('.');
  }

  function decryptSecret(value) {
    const [iv, tag, ciphertext] = value.split('.').map((part) => Buffer.from(part, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  async function gatewayCredentials(societyId) {
    const record = await PaymentGatewayAccount.findOne({ societyId, enabled: true })
      .select('+encryptedKeySecret +encryptedWebhookSecret')
      .lean();
    if (!record) {
      throw new AppError(
        409,
        'payment_gateway_not_configured',
        'Configure the society payment gateway first',
      );
    }
    return {
      keyId: record.keyId,
      keySecret: decryptSecret(record.encryptedKeySecret),
      webhookSecret: decryptSecret(record.encryptedWebhookSecret),
    };
  }

  async function razorpayRequest(credentials, path, { method = 'GET', body } = {}) {
    if (!fetchImpl)
      throw new AppError(503, 'payment_provider_unavailable', 'Payment provider is unavailable');
    let response;
    try {
      response = await fetchImpl(`https://api.razorpay.com/v1${path}`, {
        method,
        headers: {
          authorization: `Basic ${Buffer.from(`${credentials.keyId}:${credentials.keySecret}`).toString('base64')}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(10000),
      });
    } catch (error) {
      throw new AppError(502, 'payment_provider_unavailable', 'Payment provider request failed', {
        cause: error,
      });
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new AppError(
        502,
        'payment_provider_rejected',
        'Payment provider could not process the request',
        { metadata: { providerStatus: response.status } },
      );
    }
    return payload;
  }

  async function ensureDefaultAccounts(societyId, actorId) {
    await Promise.all(
      DEFAULT_ACCOUNTS.map(([code, name, type, normalBalance, systemKey]) =>
        Account.updateOne(
          { societyId, systemKey },
          {
            $setOnInsert: {
              societyId,
              code,
              name,
              type,
              normalBalance,
              systemKey,
              reconciliationEnabled: systemKey === 'bank',
              createdBy: actorId,
            },
          },
          { upsert: true },
        ),
      ),
    );
    return Account.find({ societyId, active: true }).sort({ code: 1 }).lean();
  }

  async function systemAccounts(societyId, actorId) {
    await ensureDefaultAccounts(societyId, actorId);
    return Object.fromEntries(
      (await Account.find({ societyId, systemKey: { $ne: null } }).lean()).map((account) => [
        account.systemKey,
        account,
      ]),
    );
  }

  async function postJournal({
    societyId,
    actorId = null,
    sourceType,
    sourceId,
    entryDate = clock(),
    currency,
    description,
    lines,
    reversalOf = null,
  }) {
    const existing = await JournalEntry.findOne({ societyId, sourceType, sourceId }).lean();
    if (existing) {
      await materializeJournalLines(existing);
      return existing;
    }
    const combined = new Map();
    for (const line of lines) {
      if (!Number.isSafeInteger(line.amountMinor) || line.amountMinor <= 0) {
        throw new AppError(
          422,
          'invalid_journal_amount',
          'Journal amounts must be positive integer minor units',
        );
      }
      const key = `${String(line.accountId)}:${line.side}`;
      const previous = combined.get(key);
      combined.set(key, {
        accountId: line.accountId,
        side: line.side,
        amountMinor: (previous?.amountMinor ?? 0) + line.amountMinor,
        memo: line.memo ?? previous?.memo ?? null,
      });
    }
    const balancedLines = [...combined.values()];
    const accounts = await Account.find({
      societyId,
      active: true,
      _id: { $in: balancedLines.map(({ accountId }) => accountId) },
    }).lean();
    if (accounts.length !== new Set(balancedLines.map(({ accountId }) => String(accountId))).size) {
      throw new AppError(
        422,
        'invalid_journal_account',
        'Every journal account must be active in this society',
      );
    }
    const debits = balancedLines
      .filter(({ side }) => side === 'debit')
      .reduce((sum, line) => sum + line.amountMinor, 0);
    const credits = balancedLines
      .filter(({ side }) => side === 'credit')
      .reduce((sum, line) => sum + line.amountMinor, 0);
    if (!Number.isSafeInteger(debits) || debits <= 0 || debits !== credits) {
      throw new AppError(422, 'unbalanced_journal', 'Journal entry debits must equal credits');
    }
    const entryId = new mongoose.Types.ObjectId();
    const entryNumber = `JE-${clock().toISOString().slice(0, 10).replaceAll('-', '')}-${entryId
      .toString()
      .slice(-8)
      .toUpperCase()}`;
    let entry;
    try {
      entry = await JournalEntry.create({
        _id: entryId,
        societyId,
        entryNumber,
        entryDate,
        currency,
        description,
        sourceType,
        sourceId,
        debitTotalMinor: debits,
        creditTotalMinor: credits,
        reversalOf,
        createdBy: actorId,
        lineSnapshots: balancedLines,
      });
    } catch (error) {
      if (error?.code === 11000) {
        const duplicate = await JournalEntry.findOne({ societyId, sourceType, sourceId }).lean();
        if (duplicate) return duplicate;
      }
      throw error;
    }
    await materializeJournalLines(entry.toObject());
    return entry.toObject();
  }

  async function materializeJournalLines(entry) {
    await Promise.all(
      entry.lineSnapshots.map((line, lineNumber) =>
        JournalLine.updateOne(
          { societyId: entry.societyId, journalEntryId: entry._id, lineNumber },
          {
            $setOnInsert: {
              societyId: entry.societyId,
              journalEntryId: entry._id,
              lineNumber,
              ...line,
            },
          },
          { upsert: true },
        ),
      ),
    );
  }

  async function postBillIssue({ society, actor, bill }) {
    if (!bill.totalMinor) return null;
    const accounts = await systemAccounts(society._id, actor?._id ?? bill.createdBy);
    const revenueKey =
      bill.source === 'opening_balance' ? 'adjustment_income' : 'maintenance_income';
    return postJournal({
      societyId: society._id,
      actorId: actor?._id ?? bill.issuedBy,
      sourceType: 'maintenance_bill',
      sourceId: bill._id,
      entryDate: bill.issuedAt ?? clock(),
      currency: bill.currency,
      description: `Issued maintenance bill ${bill.invoiceNumber ?? bill._id}`,
      lines: [
        {
          accountId: accounts.accounts_receivable._id,
          side: 'debit',
          amountMinor: bill.totalMinor,
        },
        { accountId: accounts[revenueKey]._id, side: 'credit', amountMinor: bill.totalMinor },
      ],
    });
  }

  async function postCreditNote({ society, actor, note }) {
    const accounts = await systemAccounts(society._id, actor?._id ?? note.createdBy);
    const incomeKey = note.category === 'late_fee' ? 'late_fee_income' : 'adjustment_income';
    const credit = note.direction === 'credit';
    return postJournal({
      societyId: society._id,
      actorId: actor?._id ?? note.issuedBy,
      sourceType: 'credit_note',
      sourceId: note._id,
      entryDate: note.issuedAt ?? clock(),
      currency: note.currency,
      description: `${credit ? 'Credit' : 'Debit'} adjustment ${note.noteNumber ?? note._id}`,
      lines: credit
        ? [
            { accountId: accounts[incomeKey]._id, side: 'debit', amountMinor: note.amountMinor },
            {
              accountId: accounts.accounts_receivable._id,
              side: 'credit',
              amountMinor: note.amountMinor,
            },
          ]
        : [
            {
              accountId: accounts.accounts_receivable._id,
              side: 'debit',
              amountMinor: note.amountMinor,
            },
            { accountId: accounts[incomeKey]._id, side: 'credit', amountMinor: note.amountMinor },
          ],
    });
  }

  async function postReceipt({ society, receipt, actorId = null, online = false }) {
    const accounts = await systemAccounts(society._id, actorId ?? receipt.receivedBy);
    const moneyAccount = online
      ? accounts.gateway_clearing
      : receipt.method === 'cash'
        ? accounts.cash
        : accounts.bank;
    const allocatedMinor = receipt.allocations.reduce(
      (sum, allocation) => sum + allocation.amountMinor,
      0,
    );
    const lines = [
      { accountId: moneyAccount._id, side: 'debit', amountMinor: receipt.amountMinor },
    ];
    if (allocatedMinor) {
      lines.push({
        accountId: accounts.accounts_receivable._id,
        side: 'credit',
        amountMinor: allocatedMinor,
      });
    }
    if (receipt.unappliedMinor) {
      lines.push({
        accountId: accounts.resident_advances._id,
        side: 'credit',
        amountMinor: receipt.unappliedMinor,
      });
    }
    return postJournal({
      societyId: society._id,
      actorId: actorId ?? receipt.receivedBy,
      sourceType: 'receipt',
      sourceId: receipt._id,
      entryDate: receipt.receivedAt,
      currency: receipt.currency,
      description: `Receipt ${receipt.receiptNumber}`,
      lines,
    });
  }

  async function postReceiptAllocation({ society, actorId, paymentAllocation }) {
    const accounts = await systemAccounts(society._id, actorId);
    return postJournal({
      societyId: society._id,
      actorId,
      sourceType: 'receipt_allocation',
      sourceId: paymentAllocation._id,
      entryDate: paymentAllocation.createdAt ?? clock(),
      currency:
        (await SocietySettings.findOne({ societyId: society._id }).lean())?.currency ?? 'INR',
      description: `Apply resident advance to bill ${paymentAllocation.billId}`,
      lines: [
        {
          accountId: accounts.resident_advances._id,
          side: 'debit',
          amountMinor: paymentAllocation.amountMinor,
        },
        {
          accountId: accounts.accounts_receivable._id,
          side: 'credit',
          amountMinor: paymentAllocation.amountMinor,
        },
      ],
    });
  }

  async function recordReceiptAllocation({ society, actor, receipt, billId, amountMinor }) {
    const payment = await Payment.findOne({
      societyId: society._id,
      receiptId: receipt._id,
    }).lean();
    if (!payment) return;
    const allocation = await PaymentAllocation.findOneAndUpdate(
      {
        societyId: society._id,
        paymentId: payment._id,
        billId,
        kind: 'collection',
        refundId: null,
      },
      {
        $setOnInsert: {
          societyId: society._id,
          paymentId: payment._id,
          receiptId: receipt._id,
          billId,
          amountMinor,
          kind: 'collection',
          createdBy: actor?._id ?? payment.createdBy,
        },
      },
      { upsert: true, returnDocument: 'after' },
    ).lean();
    await postReceiptAllocation({
      society,
      actorId: actor?._id ?? payment.createdBy,
      paymentAllocation: allocation,
    });
  }

  async function outstandingForBill(societyId, bill) {
    const [notes, receipts, reversals] = await Promise.all([
      CreditNote.find({
        societyId,
        status: 'issued',
        $or: [{ billId: bill._id }, { 'allocations.billId': bill._id }],
      }).lean(),
      Receipt.find({ societyId, 'allocations.billId': bill._id }).lean(),
      PaymentAllocation.find({
        societyId,
        billId: bill._id,
        kind: { $in: ['refund', 'reversal'] },
      }).lean(),
    ]);
    let adjusted = bill.totalMinor;
    for (const note of notes) {
      const allocations = note.allocations?.length
        ? note.allocations
        : note.billId && String(note.billId) === String(bill._id)
          ? [{ billId: bill._id, amountMinor: note.amountMinor }]
          : [];
      for (const allocation of allocations) {
        if (String(allocation.billId) === String(bill._id)) {
          adjusted += (note.direction === 'debit' ? 1 : -1) * allocation.amountMinor;
        }
      }
    }
    const paid = receipts.reduce(
      (sum, receipt) =>
        sum +
        receipt.allocations
          .filter(({ billId }) => String(billId) === String(bill._id))
          .reduce((subtotal, allocation) => subtotal + allocation.amountMinor, 0),
      0,
    );
    const refunds = reversals.reduce((sum, allocation) => sum + allocation.amountMinor, 0);
    return Math.max(0, adjusted - paid + refunds);
  }

  async function eligiblePayment({ society, membership, billId, amountMinor }) {
    const bill = await MaintenanceBill.findOne({
      societyId: society._id,
      _id: billId,
      status: 'issued',
    }).lean();
    if (!bill) throw new AppError(404, 'bill_not_found', 'Issued bill was not found');
    if (!bill.ownerMembershipIds.some((ownerId) => String(ownerId) === String(membership._id))) {
      throw new AppError(404, 'bill_not_found', 'Issued bill was not found');
    }
    const remaining = await outstandingForBill(society._id, bill);
    if (amountMinor > remaining) {
      throw new AppError(
        422,
        'payment_exceeds_balance',
        'The payment exceeds the bill outstanding balance',
      );
    }
    return bill;
  }

  async function getGateway({ society }) {
    const record = await PaymentGatewayAccount.findOne({ societyId: society._id }).lean();
    return {
      configured: Boolean(record?.enabled),
      provider: record?.provider ?? 'razorpay',
      keyId: record?.keyId ?? null,
      webhookUrl: `/api/v1/webhooks/razorpay/${society._id}`,
    };
  }

  async function configureGateway({ society, actor, data, request }) {
    const keyId = data.keyId.trim();
    const existing = await PaymentGatewayAccount.findOne({ societyId: society._id });
    if (existing) {
      existing.keyId = keyId;
      existing.encryptedKeySecret = encryptSecret(data.keySecret);
      existing.encryptedWebhookSecret = encryptSecret(data.webhookSecret);
      existing.enabled = true;
      existing.configuredBy = actor._id;
      await existing.save();
    } else {
      await PaymentGatewayAccount.create({
        societyId: society._id,
        keyId,
        encryptedKeySecret: encryptSecret(data.keySecret),
        encryptedWebhookSecret: encryptSecret(data.webhookSecret),
        configuredBy: actor._id,
      });
    }
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'finance.gateway.configure',
      targetType: 'payment_gateway',
      outcome: 'success',
      requestId: request.id,
      metadata: { provider: 'razorpay', keyId: keyId.slice(0, 8) },
    });
    return getGateway({ society });
  }

  async function createPaymentLink({ society, membership, data, request }) {
    const bill = await eligiblePayment({
      society,
      membership,
      billId: data.billId,
      amountMinor: data.amountMinor,
    });
    const settings = await SocietySettings.findOne({ societyId: society._id }).lean();
    if (!settings?.currency || settings.currency !== bill.currency) {
      throw new AppError(
        409,
        'currency_mismatch',
        'The bill currency is not available for payment',
      );
    }
    const idempotencyKey = data.idempotencyKey;
    const existing = await Payment.findOne({ societyId: society._id, idempotencyKey })
      .select('+checkoutUrl')
      .lean();
    if (existing) {
      if (existing.status !== 'pending' || !existing.checkoutUrl) {
        throw new AppError(
          409,
          'payment_request_already_used',
          'This payment request has already been processed',
        );
      }
      return {
        payment: { ...existing, id: String(existing._id) },
        shortUrl: existing.checkoutUrl,
      };
    }
    const credentials = await gatewayCredentials(society._id);
    const paymentId = new mongoose.Types.ObjectId();
    const payment = new Payment({
      _id: paymentId,
      societyId: society._id,
      flatId: bill.flatId,
      payerMembershipId: membership._id,
      billId: bill._id,
      amountMinor: data.amountMinor,
      currency: bill.currency,
      method: 'online',
      status: 'pending',
      provider: 'razorpay',
      createdBy: membership.userId,
      idempotencyKey,
    });
    await payment.save();
    let link;
    try {
      link = await razorpayRequest(credentials, '/payment_links', {
        method: 'POST',
        body: {
          amount: data.amountMinor,
          currency: bill.currency,
          reference_id: String(paymentId),
          description: `Society maintenance bill ${bill.invoiceNumber}`,
          accept_partial: false,
          notify: { sms: false, email: false },
          reminder_enable: false,
        },
      });
    } catch (error) {
      payment.status = 'failed';
      await payment.save();
      throw error;
    }
    payment.providerReference = link.id;
    payment.checkoutUrl = link.short_url;
    await payment.save();
    await audit.record({
      actorId: membership.userId,
      societyId: society._id,
      action: 'finance.payment.initiate',
      targetType: 'payment',
      targetId: payment._id,
      outcome: 'success',
      requestId: request.id,
      metadata: { billId: bill._id, amountMinor: payment.amountMinor, currency: payment.currency },
    });
    return {
      payment: { ...payment.toObject(), id: String(payment._id) },
      shortUrl: link.short_url,
      methodAvailability:
        'UPI, card, and net banking are shown by Razorpay when enabled for the society merchant account.',
    };
  }

  function verifyWebhookSignature(rawBody, signature, secret) {
    if (!Buffer.isBuffer(rawBody) || !signature) return false;
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
    let actual;
    try {
      actual = Buffer.from(signature, 'hex');
    } catch {
      return false;
    }
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }

  async function addPaymentAllocations({ societyId, payment, receipt, kind, actorId = null }) {
    const lines = receipt.allocations ?? [];
    if (!lines.length) return;
    await Promise.all(
      lines.map(({ billId, amountMinor }) =>
        PaymentAllocation.updateOne(
          {
            societyId,
            paymentId: payment._id,
            billId,
            kind,
            refundId: null,
          },
          {
            $setOnInsert: {
              societyId,
              paymentId: payment._id,
              receiptId: receipt._id,
              billId,
              amountMinor,
              kind,
              createdBy: actorId,
            },
          },
          { upsert: true },
        ),
      ),
    );
  }

  async function capturePayment({ society, payment, providerPayment, request }) {
    if (payment.status === 'captured') return payment.toObject();
    if (providerPayment.status !== 'captured' || providerPayment.amount !== payment.amountMinor) {
      throw new AppError(
        422,
        'payment_verification_failed',
        'The payment does not match the requested amount',
      );
    }
    if (
      providerPayment.currency !== payment.currency ||
      providerPayment.payment_link_id !== payment.providerReference
    ) {
      throw new AppError(
        422,
        'payment_verification_failed',
        'The payment provider reference could not be verified',
      );
    }
    const locked = await Payment.findOneAndUpdate(
      { societyId: society._id, _id: payment._id, status: 'pending' },
      {
        $set: {
          status: 'processing',
          providerPaymentId: providerPayment.id,
          method: ['upi', 'card', 'netbanking'].includes(providerPayment.method)
            ? providerPayment.method
            : 'online',
        },
      },
      { returnDocument: 'after' },
    );
    if (!locked && payment.status !== 'processing') {
      return Payment.findOne({ societyId: society._id, _id: payment._id }).lean();
    }
    const bill = await MaintenanceBill.findOne({
      societyId: society._id,
      _id: payment.billId,
      flatId: payment.flatId,
    }).lean();
    const eligible =
      bill?.status === 'issued' &&
      bill.ownerMembershipIds.some(
        (membershipId) => String(membershipId) === String(payment.payerMembershipId),
      );
    const outstandingMinor = eligible ? await outstandingForBill(society._id, bill) : 0;
    const allocatedMinor = Math.min(payment.amountMinor, outstandingMinor);
    const receiptAllocations = allocatedMinor
      ? [{ billId: bill._id, amountMinor: allocatedMinor }]
      : [];
    let receipt = await Receipt.findOne({ societyId: society._id, paymentId: payment._id });
    if (!receipt) {
      receipt = await Receipt.create({
        societyId: society._id,
        paymentId: payment._id,
        receiptNumber: `RCT-${clock().toISOString().slice(0, 10).replaceAll('-', '')}-${String(payment._id).slice(-8).toUpperCase()}`,
        payerMembershipId: payment.payerMembershipId,
        flatId: payment.flatId,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        receivedAt: clock(),
        method:
          payment.method === 'upi'
            ? 'other'
            : payment.method === 'card'
              ? 'other'
              : payment.method === 'netbanking'
                ? 'bank_transfer'
                : 'other',
        reference: providerPayment.id,
        allocations: receiptAllocations,
        unappliedMinor: payment.amountMinor - allocatedMinor,
        receivedBy: payment.createdBy,
        allocationMode: 'manual',
        reason: 'Captured through Razorpay; provider webhook verified',
      });
    }
    await addPaymentAllocations({ societyId: society._id, payment, receipt, kind: 'collection' });
    await postReceipt({ society, receipt, actorId: payment.createdBy, online: true });
    payment.status = 'captured';
    payment.providerPaymentId = providerPayment.id;
    payment.receiptId = receipt._id;
    payment.capturedAt = clock();
    await payment.save();
    await audit.record({
      actorId: payment.createdBy,
      societyId: society._id,
      action: 'finance.payment.captured',
      targetType: 'payment',
      targetId: payment._id,
      outcome: 'success',
      requestId: request?.id ?? null,
      metadata: { amountMinor: payment.amountMinor, receiptId: receipt._id },
    });
    return payment.toObject();
  }

  async function processWebhook({ societyId, rawBody, signature, eventId, request }) {
    const society = { _id: societyId };
    const credentials = await gatewayCredentials(societyId);
    if (!verifyWebhookSignature(rawBody, signature, credentials.webhookSecret)) {
      await audit.record({
        societyId,
        action: 'finance.webhook.signature_failed',
        targetType: 'payment_gateway',
        outcome: 'failure',
        requestId: request?.id ?? null,
      });
      throw new AppError(401, 'invalid_webhook_signature', 'Webhook signature verification failed');
    }
    if (!eventId || eventId.length > 200) {
      throw new AppError(400, 'invalid_webhook_event', 'A provider event identifier is required');
    }
    let event;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new AppError(400, 'invalid_webhook_payload', 'Webhook payload is invalid');
    }
    let storedEvent = await PaymentWebhookEvent.findOne({
      societyId,
      provider: 'razorpay',
      eventId,
    });
    if (storedEvent?.outcome === 'processed' || storedEvent?.outcome === 'ignored') {
      return { duplicate: true };
    }
    if (!storedEvent) {
      try {
        storedEvent = await PaymentWebhookEvent.create({
          societyId,
          provider: 'razorpay',
          eventId,
          eventType: String(event.event ?? 'unknown').slice(0, 100),
          outcome: 'processing',
        });
      } catch (error) {
        if (error?.code !== 11000) throw error;
        storedEvent = await PaymentWebhookEvent.findOne({
          societyId,
          provider: 'razorpay',
          eventId,
        });
        if (storedEvent?.outcome === 'processed' || storedEvent?.outcome === 'ignored') {
          return { duplicate: true };
        }
      }
    }
    try {
      if (event.event === 'payment.captured' || event.event === 'payment.failed') {
        const payload = event.payload?.payment?.entity;
        if (!payload?.id || !payload.payment_link_id) {
          throw new AppError(
            422,
            'invalid_webhook_payload',
            'Payment event is missing its provider reference',
          );
        }
        const payment = await Payment.findOne({
          societyId,
          provider: 'razorpay',
          providerReference: payload.payment_link_id,
        });
        if (!payment) {
          storedEvent.outcome = 'ignored';
          await storedEvent.save();
          return { ignored: true };
        }
        const providerPayment = await razorpayRequest(
          credentials,
          `/payments/${encodeURIComponent(payload.id)}`,
        );
        if (event.event === 'payment.captured') {
          await capturePayment({ society, payment, providerPayment, request });
        } else {
          if (providerPayment.status !== 'failed') {
            throw new AppError(
              422,
              'payment_verification_failed',
              'Provider payment failure could not be verified',
            );
          }
          payment.status = 'failed';
          payment.failureCode = String(providerPayment.error_code ?? '').slice(0, 80) || null;
          payment.failureDescription =
            String(providerPayment.error_description ?? '').slice(0, 240) || null;
          await payment.save();
          await audit.record({
            actorId: payment.createdBy,
            societyId,
            action: 'finance.payment.failed',
            targetType: 'payment',
            targetId: payment._id,
            outcome: 'failure',
            requestId: request?.id ?? null,
            metadata: { failureCode: payment.failureCode },
          });
        }
      } else if (event.event === 'refund.processed' || event.event === 'refund.failed') {
        const refundEntity = event.payload?.refund?.entity;
        const paymentId = refundEntity?.payment_id;
        const payment = await Payment.findOne({ societyId, providerPaymentId: paymentId });
        const refund = payment?.refunds?.find((item) => item.providerRefundId === refundEntity?.id);
        if (!payment || !refund) {
          storedEvent.outcome = 'ignored';
          await storedEvent.save();
          return { ignored: true };
        }
        if (
          refundEntity.amount !== refund.amountMinor ||
          refundEntity.payment_id !== payment.providerPaymentId
        ) {
          throw new AppError(
            422,
            'refund_verification_failed',
            'The refund event does not match the approved refund',
          );
        }
        if (event.event === 'refund.processed') {
          await postProcessedRefund({ society, payment, refund, actorId: refund.approvedBy });
        } else {
          refund.status = 'failed';
          payment.refundStatus = 'failed';
          if (payment.status === 'refund_pending') payment.status = 'captured';
          await payment.save();
        }
      } else {
        storedEvent.outcome = 'ignored';
      }
      storedEvent.outcome = 'processed';
      storedEvent.processedAt = clock();
      await storedEvent.save();
      return { received: true };
    } catch (error) {
      storedEvent.outcome = 'processing';
      await storedEvent.save();
      throw error;
    }
  }

  async function recordManualReceipt({ society, actor, billingService, data, request }) {
    const existing = data.idempotencyKey
      ? await Payment.findOne({
          societyId: society._id,
          idempotencyKey: data.idempotencyKey,
        }).lean()
      : null;
    if (existing) {
      const priorReceipt = await Receipt.findOne({
        societyId: society._id,
        paymentId: existing._id,
      }).lean();
      if (!priorReceipt) {
        throw new AppError(
          409,
          'payment_record_incomplete',
          'The existing payment is still being recorded',
        );
      }
      await addPaymentAllocations({
        societyId: society._id,
        payment: existing,
        receipt: priorReceipt,
        kind: 'collection',
        actorId: actor._id,
      });
      await postReceipt({ society, receipt: priorReceipt, actorId: actor._id });
      return priorReceipt;
    }
    const receipt = await billingService.createReceipt({ society, actor, data, request });
    const payment = await Payment.create({
      societyId: society._id,
      flatId: receipt.flatId,
      payerMembershipId: receipt.payerMembershipId,
      amountMinor: receipt.amountMinor,
      currency: receipt.currency,
      method: 'manual',
      status: 'captured',
      provider: 'manual',
      billId: receipt.allocations[0]?.billId ?? null,
      providerReference: receipt.reference ?? null,
      receiptId: receipt._id,
      capturedAt: receipt.receivedAt,
      createdBy: actor._id,
      idempotencyKey: data.idempotencyKey ?? `manual:${receipt._id}`,
    });
    await Receipt.updateOne(
      { societyId: society._id, _id: receipt._id },
      { $set: { paymentId: payment._id } },
    );
    receipt.paymentId = payment._id;
    await addPaymentAllocations({
      societyId: society._id,
      payment,
      receipt,
      kind: 'collection',
      actorId: actor._id,
    });
    await postReceipt({ society, receipt, actorId: actor._id });
    return { ...receipt, paymentId: String(payment._id) };
  }

  async function createVendor({ society, actor, data, request }) {
    const vendor = await Vendor.create({ societyId: society._id, ...data, createdBy: actor._id });
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'finance.vendor.create',
      targetType: 'vendor',
      targetId: vendor._id,
      outcome: 'success',
      requestId: request.id,
    });
    return vendor.toObject();
  }

  async function listVendors({ society }) {
    return Vendor.find({ societyId: society._id, status: 'active' }).sort({ name: 1 }).lean();
  }

  async function createAccount({ society, actor, data, request }) {
    const account = await Account.create({
      societyId: society._id,
      ...data,
      normalBalance: ['asset', 'expense'].includes(data.type) ? 'debit' : 'credit',
      createdBy: actor._id,
    });
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'finance.account.create',
      targetType: 'account',
      targetId: account._id,
      outcome: 'success',
      requestId: request.id,
    });
    return account.toObject();
  }

  async function listAccounts({ society, actor }) {
    return ensureDefaultAccounts(society._id, actor._id);
  }

  async function createExpense({ society, actor, data, request }) {
    const [vendor, account, settings, approvalPolicy] = await Promise.all([
      Vendor.findOne({ societyId: society._id, _id: data.vendorId, status: 'active' }).lean(),
      Account.findOne({
        societyId: society._id,
        _id: data.expenseAccountId,
        type: 'expense',
        active: true,
      }).lean(),
      SocietySettings.findOne({ societyId: society._id }).lean(),
      ApprovalPolicies.findOne({ societyId: society._id }).lean(),
    ]);
    if (!vendor || !account)
      throw new AppError(
        422,
        'invalid_finance_reference',
        'Select a valid vendor and expense account',
      );
    if (data.currency !== settings?.currency) {
      throw new AppError(
        422,
        'currency_mismatch',
        'Expense currency must match the society accounting currency',
      );
    }
    const policy = approvalPolicy?.policies?.find(({ operation }) => operation === 'expense');
    if (policy?.enabled === false) {
      throw new AppError(
        422,
        'expense_disabled',
        'Expense recording is disabled by society approval policy',
      );
    }
    const expense = await Expense.create({
      societyId: society._id,
      ...data,
      status: 'pending_approval',
      createdBy: actor._id,
    });
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'finance.expense.create',
      targetType: 'expense',
      targetId: expense._id,
      outcome: 'success',
      requestId: request.id,
      metadata: { amountMinor: expense.amountMinor, currency: expense.currency },
    });
    return expense.toObject();
  }

  async function approveExpense({ society, actor, expenseId, request }) {
    const expense = await Expense.findOne({ societyId: society._id, _id: expenseId });
    if (!expense || expense.status !== 'pending_approval') {
      throw new AppError(404, 'expense_not_approvable', 'Pending expense was not found');
    }
    if (expense.approvalUserIds.some((userId) => String(userId) === String(actor._id))) {
      throw new AppError(
        409,
        'duplicate_expense_approval',
        'You have already approved this expense',
      );
    }
    expense.approvalUserIds.push(actor._id);
    const policy = await ApprovalPolicies.findOne({ societyId: society._id }).lean();
    const required =
      policy?.policies?.find(({ operation }) => operation === 'expense')?.requiredApprovals ?? 1;
    if (expense.approvalUserIds.length >= required) {
      const accounts = await systemAccounts(society._id, actor._id);
      const payable = accounts.accounts_payable;
      const journal = await postJournal({
        societyId: society._id,
        actorId: actor._id,
        sourceType: 'expense',
        sourceId: expense._id,
        entryDate: expense.incurredAt,
        currency: expense.currency,
        description: expense.description,
        lines: [
          { accountId: expense.expenseAccountId, side: 'debit', amountMinor: expense.amountMinor },
          { accountId: payable._id, side: 'credit', amountMinor: expense.amountMinor },
        ],
      });
      expense.status = 'posted';
      expense.approvedBy = actor._id;
      expense.approvedAt = clock();
      expense.postedAt = clock();
      expense.journalEntryId = journal._id;
    }
    await expense.save();
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'finance.expense.approve',
      targetType: 'expense',
      targetId: expense._id,
      outcome: 'success',
      requestId: request.id,
      metadata: { approvals: expense.approvalUserIds.length, required },
    });
    return expense.toObject();
  }

  async function recordVendorPayment({ society, actor, expenseId, data, request }) {
    const expense = await Expense.findOne({ societyId: society._id, _id: expenseId });
    if (!expense || !['posted', 'partially_paid'].includes(expense.status)) {
      throw new AppError(
        404,
        'expense_not_payable',
        'An approved outstanding expense was not found',
      );
    }
    const due = expense.amountMinor - expense.paidMinor;
    if (data.amountMinor > due)
      throw new AppError(422, 'payment_exceeds_payable', 'Payment exceeds the expense payable');
    const accounts = await systemAccounts(society._id, actor._id);
    const moneyAccount = data.method === 'cash' ? accounts.cash : accounts.bank;
    const sourceId = new mongoose.Types.ObjectId();
    const journal = await postJournal({
      societyId: society._id,
      actorId: actor._id,
      sourceType: 'vendor_payment',
      sourceId,
      entryDate: data.paidAt ? new Date(data.paidAt) : clock(),
      currency: expense.currency,
      description: `Vendor payment for expense ${expense._id}`,
      lines: [
        { accountId: accounts.accounts_payable._id, side: 'debit', amountMinor: data.amountMinor },
        { accountId: moneyAccount._id, side: 'credit', amountMinor: data.amountMinor },
      ],
    });
    expense.vendorPayments.push({
      ...data,
      paidAt: data.paidAt ? new Date(data.paidAt) : clock(),
      journalEntryId: journal._id,
      recordedBy: actor._id,
    });
    expense.paidMinor += data.amountMinor;
    expense.status = expense.paidMinor === expense.amountMinor ? 'paid' : 'partially_paid';
    await expense.save();
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'finance.vendor_payment.record',
      targetType: 'expense',
      targetId: expense._id,
      outcome: 'success',
      requestId: request.id,
      metadata: { amountMinor: data.amountMinor, method: data.method },
    });
    return expense.toObject();
  }

  async function listExpenses({ society }) {
    return Expense.find({ societyId: society._id }).sort({ incurredAt: -1 }).lean();
  }

  async function reverseVendorPayment({
    society,
    actor,
    expenseId,
    vendorPaymentId,
    reason,
    request,
  }) {
    const expense = await Expense.findOne({ societyId: society._id, _id: expenseId });
    const payment = expense?.vendorPayments.id(vendorPaymentId);
    if (!expense || !payment) {
      throw new AppError(404, 'vendor_payment_not_found', 'Vendor payment was not found');
    }
    if (payment.reversalJournalEntryId) {
      throw new AppError(409, 'vendor_payment_reversed', 'Vendor payment is already reversed');
    }
    if (expense.paidMinor < payment.amountMinor) {
      throw new AppError(
        409,
        'vendor_payment_balance_mismatch',
        'Expense payment balance is inconsistent',
      );
    }
    const original = await JournalEntry.findOne({
      societyId: society._id,
      _id: payment.journalEntryId,
    }).lean();
    if (!original) {
      throw new AppError(
        409,
        'vendor_payment_journal_missing',
        'The vendor payment journal entry is unavailable',
      );
    }
    const reversal = await postJournal({
      societyId: society._id,
      actorId: actor._id,
      sourceType: 'vendor_payment_reversal',
      sourceId: payment._id,
      entryDate: clock(),
      currency: expense.currency,
      description: `Reversal of vendor payment for expense ${expense._id}: ${reason}`,
      reversalOf: original._id,
      lines: original.lineSnapshots.map((line) => ({
        ...line,
        side: line.side === 'debit' ? 'credit' : 'debit',
      })),
    });
    payment.reversalJournalEntryId = reversal._id;
    payment.reversedAt = clock();
    payment.reversedBy = actor._id;
    payment.reversalReason = reason;
    expense.paidMinor -= payment.amountMinor;
    expense.status = expense.paidMinor === 0 ? 'posted' : 'partially_paid';
    await expense.save();
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'finance.vendor_payment.reverse',
      targetType: 'expense',
      targetId: expense._id,
      outcome: 'success',
      requestId: request.id,
      metadata: { paymentId: payment._id, journalEntryId: reversal._id, reason },
    });
    return expense.toObject();
  }

  async function requestRefund({ society, actor, paymentId, data, request }) {
    const payment = await Payment.findOne({
      societyId: society._id,
      _id: paymentId,
      status: 'captured',
    });
    if (!payment)
      throw new AppError(404, 'payment_not_refundable', 'Captured payment was not found');
    const reservedRefundMinor = payment.refunds
      .filter(({ status }) => ['pending', 'approved', 'processing'].includes(status))
      .reduce((sum, refund) => sum + refund.amountMinor, 0);
    if (
      !Number.isSafeInteger(data.amountMinor) ||
      data.amountMinor < 1 ||
      data.amountMinor > payment.amountMinor - payment.refundedMinor - reservedRefundMinor
    ) {
      throw new AppError(
        422,
        'invalid_refund_amount',
        'Refund exceeds the unrefunded captured amount',
      );
    }
    payment.refunds.push({
      _id: new mongoose.Types.ObjectId(),
      amountMinor: data.amountMinor,
      reason: data.reason,
      status: 'pending',
      requestedBy: actor._id,
      requestedAt: clock(),
    });
    payment.refundStatus = 'pending';
    await payment.save();
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'finance.refund.request',
      targetType: 'payment',
      targetId: payment._id,
      outcome: 'success',
      requestId: request.id,
      metadata: { amountMinor: data.amountMinor, reason: data.reason },
    });
    return payment.toObject();
  }

  async function postProcessedRefund({ society, payment, refund, actorId }) {
    if (refund.status === 'processed') return;
    const accounts = await systemAccounts(society._id, actorId ?? payment.createdBy);
    const receipt =
      payment.provider === 'manual'
        ? await Receipt.findOne({ societyId: society._id, paymentId: payment._id }).lean()
        : null;
    const refundAccount =
      payment.provider === 'manual' && receipt?.method === 'cash'
        ? accounts.cash
        : payment.provider === 'manual'
          ? accounts.bank
          : accounts.gateway_clearing;
    const sourceId = new mongoose.Types.ObjectId(refund._id);
    const allocations = await PaymentAllocation.find({
      societyId: society._id,
      paymentId: payment._id,
      kind: 'collection',
    }).lean();
    const previousRefunds = await PaymentAllocation.find({
      societyId: society._id,
      paymentId: payment._id,
      kind: 'refund',
      refundId: { $ne: refund._id },
    }).lean();
    const priorByBill = new Map();
    for (const allocation of previousRefunds) {
      priorByBill.set(
        String(allocation.billId),
        (priorByBill.get(String(allocation.billId)) ?? 0) + allocation.amountMinor,
      );
    }
    const currentRefunds = await PaymentAllocation.find({
      societyId: society._id,
      paymentId: payment._id,
      kind: 'refund',
      refundId: refund._id,
    }).lean();
    const currentByBill = new Map(
      currentRefunds.map((allocation) => [String(allocation.billId), allocation]),
    );
    let remaining = refund.amountMinor;
    let reversedReceivableMinor = currentRefunds.reduce(
      (sum, allocation) => sum + allocation.amountMinor,
      0,
    );
    for (const allocation of allocations) {
      if (!remaining) break;
      const currentForBill = currentByBill.get(String(allocation.billId))?.amountMinor ?? 0;
      const available = Math.max(
        0,
        allocation.amountMinor - (priorByBill.get(String(allocation.billId)) ?? 0) - currentForBill,
      );
      const amountMinor = Math.min(remaining, available);
      if (!amountMinor) continue;
      await PaymentAllocation.updateOne(
        {
          societyId: society._id,
          paymentId: payment._id,
          billId: allocation.billId,
          kind: 'refund',
          refundId: refund._id,
        },
        {
          $setOnInsert: {
            societyId: society._id,
            paymentId: payment._id,
            billId: allocation.billId,
            amountMinor,
            kind: 'refund',
            refundId: refund._id,
            createdBy: actorId,
          },
        },
        { upsert: true },
      );
      remaining -= amountMinor;
      reversedReceivableMinor += amountMinor;
    }
    const advanceRefundMinor = refund.amountMinor - reversedReceivableMinor;
    const refundLines = [];
    if (reversedReceivableMinor) {
      refundLines.push({
        accountId: accounts.accounts_receivable._id,
        side: 'debit',
        amountMinor: reversedReceivableMinor,
      });
    }
    if (advanceRefundMinor) {
      refundLines.push({
        accountId: accounts.resident_advances._id,
        side: 'debit',
        amountMinor: advanceRefundMinor,
      });
    }
    refundLines.push({
      accountId: refundAccount._id,
      side: 'credit',
      amountMinor: refund.amountMinor,
    });
    await postJournal({
      societyId: society._id,
      actorId,
      sourceType: 'payment_refund',
      sourceId,
      entryDate: clock(),
      currency: payment.currency,
      description: `Refund for payment ${payment._id}`,
      lines: refundLines,
    });
    refund.status = 'processed';
    refund.processedAt = clock();
    payment.refundedMinor += refund.amountMinor;
    payment.refundStatus = 'processed';
    payment.status = payment.refundedMinor === payment.amountMinor ? 'refunded' : 'captured';
    await payment.save();
  }

  async function approveRefund({ society, actor, paymentId, refundId, request }) {
    const payment = await Payment.findOne({ societyId: society._id, _id: paymentId });
    const refund = payment?.refunds?.id(refundId);
    if (!payment || !refund || refund.status !== 'pending') {
      throw new AppError(404, 'refund_not_approvable', 'Pending refund was not found');
    }
    refund.status = 'approved';
    refund.approvedBy = actor._id;
    refund.approvedAt = clock();
    payment.refundStatus = 'approved';
    await payment.save();
    if (payment.provider === 'razorpay') {
      const credentials = await gatewayCredentials(society._id);
      const providerRefund = await razorpayRequest(
        credentials,
        `/payments/${encodeURIComponent(payment.providerPaymentId)}/refund`,
        {
          method: 'POST',
          body: { amount: refund.amountMinor, notes: { society_payment_id: String(payment._id) } },
        },
      );
      refund.providerRefundId = providerRefund.id;
      refund.status = 'approved';
      payment.status = 'refund_pending';
      await payment.save();
    } else {
      await postProcessedRefund({ society, payment, refund, actorId: actor._id });
    }
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'finance.refund.approve',
      targetType: 'payment',
      targetId: payment._id,
      outcome: 'success',
      requestId: request.id,
      metadata: { refundId, amountMinor: refund.amountMinor },
    });
    return payment.toObject();
  }

  async function listPayments({ society, membership }) {
    const filter = { societyId: society._id };
    if (membership.role === 'house_owner') filter.payerMembershipId = membership._id;
    const payments = await Payment.find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .populate({ path: 'receiptId', select: 'receiptNumber receivedAt amountMinor currency' })
      .lean();
    return payments.map((payment) => ({ ...payment, id: String(payment._id) }));
  }

  async function createVendorExpenseReport({ society, actor, from, to }) {
    await ensureDefaultAccounts(society._id, actor._id);
    const entries = await JournalEntry.find({
      societyId: society._id,
      entryDate: { $gte: from, $lte: to },
    })
      .select('_id')
      .lean();
    const lines = await JournalLine.find({
      societyId: society._id,
      journalEntryId: { $in: entries.map(({ _id }) => _id) },
    })
      .populate({ path: 'accountId', select: 'code name type systemKey' })
      .lean();
    const totals = new Map();
    for (const line of lines) {
      const account = line.accountId;
      if (!account) continue;
      const row = totals.get(String(account._id)) ?? {
        accountId: String(account._id),
        code: account.code,
        name: account.name,
        type: account.type,
        debitMinor: 0,
        creditMinor: 0,
      };
      row[line.side === 'debit' ? 'debitMinor' : 'creditMinor'] += line.amountMinor;
      totals.set(String(account._id), row);
    }
    const [bills, payments, expenses] = await Promise.all([
      MaintenanceBill.find({
        societyId: society._id,
        status: 'issued',
        issuedAt: { $gte: from, $lte: to },
      }).lean(),
      Payment.find({
        societyId: society._id,
        status: 'captured',
        capturedAt: { $gte: from, $lte: to },
      }).lean(),
      Expense.find({
        societyId: society._id,
        status: { $in: ['posted', 'partially_paid', 'paid'] },
        postedAt: { $gte: from, $lte: to },
      }).lean(),
    ]);
    const outstandingBalances = await Promise.all(
      (await MaintenanceBill.find({ societyId: society._id, status: 'issued' }).lean()).map(
        (bill) => outstandingForBill(society._id, bill),
      ),
    );
    return {
      period: { from, to },
      currency:
        (await SocietySettings.findOne({ societyId: society._id }).lean())?.currency ?? 'INR',
      incomeMinor: [...totals.values()]
        .filter(({ type }) => type === 'income')
        .reduce((sum, row) => sum + row.creditMinor - row.debitMinor, 0),
      expenseMinor: [...totals.values()]
        .filter(({ type }) => type === 'expense')
        .reduce((sum, row) => sum + row.debitMinor - row.creditMinor, 0),
      billIssuedMinor: bills.reduce((sum, bill) => sum + bill.totalMinor, 0),
      collectedMinor: payments.reduce((sum, payment) => sum + payment.amountMinor, 0),
      refundedMinor: payments.reduce((sum, payment) => sum + payment.refundedMinor, 0),
      netCollectionsMinor: payments.reduce(
        (sum, payment) => sum + payment.amountMinor - payment.refundedMinor,
        0,
      ),
      expensesPostedMinor: expenses.reduce((sum, expense) => sum + expense.amountMinor, 0),
      duesMinor: outstandingBalances.reduce((sum, amount) => sum + amount, 0),
      accounts: [...totals.values()].sort((left, right) => left.code.localeCompare(right.code)),
    };
  }

  function parseCsv(csvText) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let index = 0; index < csvText.length; index += 1) {
      const character = csvText[index];
      if (quoted && character === '"' && csvText[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = !quoted;
      else if (character === ',' && !quoted) {
        row.push(field);
        field = '';
      } else if ((character === '\n' || character === '\r') && !quoted) {
        if (character === '\r' && csvText[index + 1] === '\n') index += 1;
        row.push(field);
        if (row.some((cell) => cell.trim())) rows.push(row);
        row = [];
        field = '';
      } else field += character;
    }
    if (quoted) throw new AppError(422, 'invalid_csv', 'CSV contains an unclosed quoted field');
    row.push(field);
    if (row.some((cell) => cell.trim())) rows.push(row);
    return rows;
  }

  function parseMajorAmount(value, currency) {
    const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
    if (!match) {
      throw new AppError(422, 'invalid_statement_amount', 'CSV amounts must be decimal numbers');
    }
    const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits;
    const fraction = match[3] ?? '';
    if (fraction.length > digits) {
      throw new AppError(
        422,
        'invalid_statement_amount',
        'CSV amount uses unsupported currency precision',
      );
    }
    const factor = 10n ** BigInt(digits);
    const minor =
      BigInt(match[2]) * factor + BigInt((fraction + '0'.repeat(digits)).slice(0, digits) || '0');
    if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new AppError(422, 'invalid_statement_amount', 'CSV amount is outside supported range');
    }
    return Number(match[1] ? -minor : minor);
  }

  async function importStatement({ society, actor, data, request }) {
    if (data.csv.length > 900000)
      throw new AppError(413, 'statement_too_large', 'Statement CSV exceeds the supported size');
    const account = await Account.findOne({
      societyId: society._id,
      _id: data.accountId,
      type: 'asset',
      reconciliationEnabled: true,
      active: true,
    }).lean();
    if (!account)
      throw new AppError(
        404,
        'bank_account_not_found',
        'Active bank or cash account was not found',
      );
    const settings = await SocietySettings.findOne({ societyId: society._id }).lean();
    const rows = parseCsv(data.csv);
    if (rows.length < 2)
      throw new AppError(422, 'empty_statement', 'CSV must include a header and at least one row');
    const headers = rows[0].map((header) => header.trim());
    const indexes = Object.fromEntries(
      Object.entries(data.mapping).map(([field, header]) => [field, headers.indexOf(header)]),
    );
    if (Object.values(indexes).some((index) => index < 0)) {
      throw new AppError(
        422,
        'invalid_csv_mapping',
        'Select an existing CSV header for each mapped column',
      );
    }
    const fileHash = crypto.createHash('sha256').update(data.csv).digest('hex');
    const existing = await BankStatementImport.findOne({ societyId: society._id, fileHash }).lean();
    if (existing)
      throw new AppError(
        409,
        'statement_already_imported',
        'This statement file was already imported',
      );
    const statementLines = rows.slice(1).map((cells, rowIndex) => {
      const get = (field) => cells[indexes[field]]?.trim() ?? '';
      const dateValue = get('date');
      const date = /^\d{4}-\d{2}-\d{2}$/.test(dateValue)
        ? new Date(`${dateValue}T00:00:00.000Z`)
        : new Date(dateValue);
      if (Number.isNaN(date.getTime())) {
        throw new AppError(
          422,
          'invalid_statement_date',
          `CSV row ${rowIndex + 2} has an invalid date`,
        );
      }
      const debit = parseMajorAmount(get('debit') || '0', settings.currency);
      const credit = parseMajorAmount(get('credit') || '0', settings.currency);
      const balance = parseMajorAmount(get('balance'), settings.currency);
      if (
        debit < 0 ||
        credit < 0 ||
        (debit > 0 && credit > 0) ||
        (debit === 0 && credit === 0) ||
        !get('description')
      ) {
        throw new AppError(
          422,
          'invalid_statement_row',
          `CSV row ${rowIndex + 2} has invalid transaction values`,
        );
      }
      return {
        societyId: society._id,
        accountId: account._id,
        transactionDate: date,
        description: get('description').slice(0, 240),
        reference: get('reference').slice(0, 120) || null,
        debitMinor: debit,
        creditMinor: credit,
        balanceMinor: balance,
      };
    });
    const statement = await BankStatementImport.create({
      societyId: society._id,
      accountId: account._id,
      sourceName: data.sourceName,
      fileHash,
      mapping: data.mapping,
      importedBy: actor._id,
    });
    const persistedLines = await BankStatementLine.insertMany(
      statementLines.map((line) => ({
        ...line,
        importId: statement._id,
      })),
    );
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'finance.reconciliation.import',
      targetType: 'bank_statement',
      targetId: statement._id,
      outcome: 'success',
      requestId: request.id,
      metadata: { rowCount: statementLines.length, accountId: account._id },
    });
    return {
      statement: statement.toObject(),
      lines: persistedLines.map((line) => line.toObject()),
    };
  }

  async function listStatementLines({ society, importId }) {
    const filter = { societyId: society._id };
    if (importId) filter.importId = importId;
    return BankStatementLine.find(filter).sort({ transactionDate: 1, _id: 1 }).limit(1000).lean();
  }

  async function reconcileLine({ society, actor, lineId, journalEntryId, request }) {
    const [line, entry] = await Promise.all([
      BankStatementLine.findOne({ societyId: society._id, _id: lineId }),
      JournalEntry.findOne({ societyId: society._id, _id: journalEntryId }).lean(),
    ]);
    if (!line || !entry)
      throw new AppError(
        404,
        'reconciliation_item_not_found',
        'Statement row or journal entry was not found',
      );
    if (line.matchedJournalEntryId)
      throw new AppError(409, 'statement_line_matched', 'Statement row is already reconciled');
    const expectedSide = line.creditMinor > 0 ? 'debit' : 'credit';
    const expectedAmount = line.creditMinor || line.debitMinor;
    const matchingLine = await JournalLine.findOne({
      societyId: society._id,
      journalEntryId: entry._id,
      accountId: line.accountId,
      side: expectedSide,
      amountMinor: expectedAmount,
    }).lean();
    if (!matchingLine)
      throw new AppError(
        422,
        'reconciliation_amount_mismatch',
        'Journal entry has no matching bank account line',
      );
    line.matchedJournalEntryId = entry._id;
    line.matchedBy = actor._id;
    line.matchedAt = clock();
    await line.save();
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'finance.reconciliation.match',
      targetType: 'bank_statement_line',
      targetId: line._id,
      outcome: 'success',
      requestId: request.id,
      metadata: { journalEntryId: entry._id, amountMinor: expectedAmount },
    });
    return line.toObject();
  }

  async function getReconciliationSummary({ society, importId }) {
    const query = { societyId: society._id };
    if (importId) query.importId = importId;
    const rows = await BankStatementLine.find(query).sort({ transactionDate: 1, _id: 1 }).lean();
    return {
      transactionCount: rows.length,
      matchedCount: rows.filter(({ matchedJournalEntryId }) => matchedJournalEntryId).length,
      unmatchedCount: rows.filter(({ matchedJournalEntryId }) => !matchedJournalEntryId).length,
      debitMinor: rows.reduce((sum, row) => sum + row.debitMinor, 0),
      creditMinor: rows.reduce((sum, row) => sum + row.creditMinor, 0),
      endingBalanceMinor: rows.at(-1)?.balanceMinor ?? 0,
    };
  }

  async function createSettlement({ society, actor, data, request }) {
    const accounts = await systemAccounts(society._id, actor._id);
    const bank = await Account.findOne({
      societyId: society._id,
      _id: data.bankAccountId,
      type: 'asset',
      active: true,
    }).lean();
    if (!bank || !bank.reconciliationEnabled || bank.systemKey === 'gateway_clearing') {
      throw new AppError(
        422,
        'invalid_settlement_account',
        'Select an active bank account, not the gateway clearing account',
      );
    }
    let settlement = await GatewaySettlement.findOne({
      societyId: society._id,
      reference: data.reference,
    });
    if (settlement) {
      if (
        settlement.amountMinor !== data.amountMinor ||
        String(settlement.bankAccountId) !== String(bank._id)
      ) {
        throw new AppError(
          409,
          'settlement_reference_conflict',
          'Settlement reference was already used with different details',
        );
      }
      if (settlement.journalEntryId) {
        return JournalEntry.findOne({
          societyId: society._id,
          _id: settlement.journalEntryId,
        }).lean();
      }
    } else {
      settlement = await GatewaySettlement.create({
        societyId: society._id,
        reference: data.reference,
        amountMinor: data.amountMinor,
        bankAccountId: bank._id,
        settledAt: new Date(data.settledAt),
        createdBy: actor._id,
      });
    }
    const entry = await postJournal({
      societyId: society._id,
      actorId: actor._id,
      sourceType: 'gateway_settlement',
      sourceId: settlement._id,
      entryDate: settlement.settledAt,
      currency:
        (await SocietySettings.findOne({ societyId: society._id }).lean())?.currency ?? 'INR',
      description: `Gateway settlement ${data.reference}`,
      lines: [
        { accountId: bank._id, side: 'debit', amountMinor: data.amountMinor },
        { accountId: accounts.gateway_clearing._id, side: 'credit', amountMinor: data.amountMinor },
      ],
    });
    settlement.journalEntryId = entry._id;
    await settlement.save();
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'finance.gateway.settlement',
      targetType: 'journal_entry',
      targetId: entry._id,
      outcome: 'success',
      requestId: request.id,
      metadata: { amountMinor: data.amountMinor, reference: data.reference },
    });
    return entry;
  }

  async function listJournals({ society, from, to }) {
    return JournalEntry.find({
      societyId: society._id,
      entryDate: { $gte: from, $lte: to },
    })
      .sort({ entryDate: -1 })
      .limit(200)
      .lean();
  }

  async function reverseExpense({ society, actor, expenseId, reason, request }) {
    const expense = await Expense.findOne({ societyId: society._id, _id: expenseId });
    if (!expense || !['posted', 'partially_paid', 'paid'].includes(expense.status)) {
      throw new AppError(404, 'expense_not_reversible', 'Posted expense was not found');
    }
    if (expense.paidMinor > 0) {
      throw new AppError(
        409,
        'expense_payment_exists',
        'Record or reverse vendor payments before reversing this expense',
      );
    }
    const original = await JournalEntry.findOne({
      societyId: society._id,
      _id: expense.journalEntryId,
    }).lean();
    if (!original)
      throw new AppError(
        409,
        'expense_journal_missing',
        'The expense journal entry is unavailable',
      );
    const reversal = await postJournal({
      societyId: society._id,
      actorId: actor._id,
      sourceType: 'expense_reversal',
      sourceId: expense._id,
      entryDate: clock(),
      currency: expense.currency,
      description: `Reversal of expense ${expense._id}: ${reason}`,
      reversalOf: original._id,
      lines: original.lineSnapshots.map((line) => ({
        ...line,
        side: line.side === 'debit' ? 'credit' : 'debit',
      })),
    });
    expense.status = 'reversed';
    expense.reversalJournalEntryId = reversal._id;
    expense.reversalReason = reason;
    await expense.save();
    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'finance.expense.reverse',
      targetType: 'expense',
      targetId: expense._id,
      outcome: 'success',
      requestId: request.id,
      metadata: { journalEntryId: reversal._id, reason },
    });
    return expense.toObject();
  }

  return {
    approveExpense,
    approveRefund,
    configureGateway,
    createAccount,
    createExpense,
    createPaymentLink,
    createSettlement,
    createVendor,
    ensureDefaultAccounts,
    getGateway,
    getReconciliationSummary,
    importStatement,
    listAccounts,
    listExpenses,
    listJournals,
    listPayments,
    listStatementLines,
    listVendors,
    postBillIssue,
    postCreditNote,
    postJournal,
    postProcessedRefund,
    postReceipt,
    postReceiptAllocation,
    processWebhook,
    recordManualReceipt,
    recordReceiptAllocation,
    recordVendorPayment,
    reconcileLine,
    requestRefund,
    reverseVendorPayment,
    reverseExpense,
    createVendorExpenseReport,
  };
}

module.exports = { createFinanceService };
