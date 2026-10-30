const { AppError } = require('../utils/AppError');

function createSettingsService({ models, audit, clock = () => new Date() }) {
  const { ApprovalPolicies, ChargeRules, Flat, NotificationTemplates, Society, SocietySettings } =
    models;

  async function getSocietySettings({ society, isAdmin }) {
    const now = clock();
    const [
      settings,
      latestChargeRules,
      chargeRuleHistory,
      approvalPolicies,
      notificationTemplates,
    ] = await Promise.all([
      SocietySettings.findOneAndUpdate(
        { societyId: society._id },
        { $setOnInsert: { societyId: society._id } },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      )
        .select('-chargeRulesVersion')
        .lean(),
      ChargeRules.findOne({ societyId: society._id, effectiveFrom: { $lte: now } })
        .sort({ effectiveFrom: -1, version: -1 })
        .lean(),
      isAdmin
        ? ChargeRules.find({ societyId: society._id }).sort({ version: -1 }).limit(50).lean()
        : Promise.resolve([]),
      isAdmin ? ApprovalPolicies.findOne({ societyId: society._id }).lean() : Promise.resolve(null),
      isAdmin
        ? NotificationTemplates.findOne({ societyId: society._id }).lean()
        : Promise.resolve(null),
    ]);

    const publicSociety = isAdmin
      ? {
          id: String(society._id),
          name: society.name,
          address: society.address,
          contactName: society.contactName,
          contactEmail: society.contactEmail,
          contactPhone: society.contactPhone,
          registrationNumber: society.registrationNumber,
          logoUrl: society.logoUrl,
        }
      : {
          id: String(society._id),
          name: society.name,
          address: society.address,
          logoUrl: society.logoUrl,
        };
    const publicSettings = isAdmin
      ? settings
      : {
          timeZone: settings.timeZone,
          currency: settings.currency,
          areaUnit: settings.areaUnit ?? null,
          dateFormat: settings.dateFormat,
          financialYearStartMonth: settings.financialYearStartMonth,
          financialYearStartDay: settings.financialYearStartDay,
          numbering: settings.numbering,
          branding: settings.branding,
        };
    const publicChargeRules = latestChargeRules
      ? {
          version: latestChargeRules.version,
          effectiveFrom: latestChargeRules.effectiveFrom,
          frequency: latestChargeRules.frequency,
          areaUnit: latestChargeRules.areaUnit ?? null,
          charges: latestChargeRules.charges,
          discounts: latestChargeRules.discounts ?? [],
          dueDayOfPeriod: latestChargeRules.dueDayOfPeriod,
          lateFee: latestChargeRules.lateFee,
          gracePeriodDays: latestChargeRules.gracePeriodDays,
        }
      : null;

    return {
      society: publicSociety,
      settings: publicSettings,
      chargeRules: publicChargeRules,
      ...(isAdmin
        ? {
            chargeRuleHistory: chargeRuleHistory.map((rule) => ({
              id: String(rule._id),
              version: rule.version,
              effectiveFrom: rule.effectiveFrom,
              frequency: rule.frequency,
              areaUnit: rule.areaUnit ?? null,
              charges: rule.charges,
              discounts: rule.discounts ?? [],
              dueDayOfPeriod: rule.dueDayOfPeriod,
              lateFee: rule.lateFee,
              gracePeriodDays: rule.gracePeriodDays,
              createdAt: rule.createdAt,
            })),
            approvalPolicies: approvalPolicies?.policies ?? [],
            notificationTemplates: notificationTemplates?.templates ?? [],
          }
        : {}),
    };
  }

  async function updateSocietySettings({ society, actor, changes, request }) {
    let targetId = society._id;
    let metadata = { section: Object.keys(changes)[0] };
    if (changes.profile) {
      metadata = { section: 'profile', changedFields: Object.keys(changes.profile) };
      await Society.updateOne(
        { _id: society._id },
        { $set: changes.profile },
        { runValidators: true },
      );
    } else if (changes.settings) {
      metadata = { section: 'settings', changedFields: Object.keys(changes.settings) };
      if (Object.hasOwn(changes.settings, 'areaUnit') && changes.settings.areaUnit) {
        const [incompatibleFlat, areaRules] = await Promise.all([
          Flat.exists({ societyId: society._id, areaUnit: { $ne: changes.settings.areaUnit } }),
          ChargeRules.exists({
            societyId: society._id,
            effectiveFrom: { $gte: clock() },
            charges: { $elemMatch: { calculation: 'per_area' } },
            areaUnit: { $ne: changes.settings.areaUnit },
          }),
        ]);
        if (incompatibleFlat || areaRules) {
          throw new AppError(
            422,
            'area_unit_in_use',
            'Existing flats and future per-area charge rules must use the configured society area unit',
          );
        }
      }
      await SocietySettings.findOneAndUpdate(
        { societyId: society._id },
        { $set: changes.settings, $setOnInsert: { societyId: society._id } },
        { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true },
      );
    } else if (changes.chargeRules) {
      if (changes.chargeRules.charges.some(({ calculation }) => calculation === 'per_area')) {
        const settings = await SocietySettings.findOne({ societyId: society._id }).lean();
        if (
          changes.chargeRules.charges.some(({ calculation }) => calculation === 'per_area') &&
          (!settings?.areaUnit || changes.chargeRules.areaUnit !== settings.areaUnit)
        ) {
          throw new AppError(
            422,
            'area_unit_mismatch',
            'Configure the society area unit and use it in per-area charge rules',
          );
        }
      }
      const previous = await ChargeRules.findOne({ societyId: society._id })
        .sort({ version: -1 })
        .lean();
      const now = clock();
      const effectiveFrom = new Date(changes.chargeRules.effectiveFrom);
      const startOfToday = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      );
      if (effectiveFrom < startOfToday || (previous && effectiveFrom < previous.effectiveFrom)) {
        throw new AppError(
          422,
          'charge_rules_cannot_be_backdated',
          'Charge rules cannot take effect before today or an existing rule version',
        );
      }
      await SocietySettings.updateOne(
        { societyId: society._id },
        {
          $max: {
            chargeRulesVersion: previous?.version ?? 0,
            ...(previous ? { chargeRulesEffectiveFrom: previous.effectiveFrom } : {}),
          },
          $setOnInsert: { societyId: society._id },
        },
        { upsert: true },
      );
      const versionRecord = await SocietySettings.findOneAndUpdate(
        {
          societyId: society._id,
          $or: [
            { chargeRulesEffectiveFrom: { $exists: false } },
            { chargeRulesEffectiveFrom: { $lte: effectiveFrom } },
          ],
        },
        {
          $inc: { chargeRulesVersion: 1 },
          $set: { chargeRulesEffectiveFrom: effectiveFrom },
        },
        { returnDocument: 'after' },
      )
        .select('+chargeRulesVersion')
        .lean();
      if (!versionRecord) {
        throw new AppError(
          409,
          'charge_rules_changed_concurrently',
          'A newer charge-rule revision was saved; reload settings and try again',
        );
      }
      const rule = await ChargeRules.create({
        ...changes.chargeRules,
        societyId: society._id,
        version: versionRecord.chargeRulesVersion,
        effectiveFrom,
        createdBy: actor._id,
      });
      metadata = { section: 'chargeRules', version: rule.version, effectiveFrom };
      targetId = rule._id;
    } else if (changes.approvalPolicies) {
      metadata = {
        section: 'approvalPolicies',
        operations: changes.approvalPolicies.policies.map(({ operation }) => operation),
      };
      await ApprovalPolicies.findOneAndUpdate(
        { societyId: society._id },
        {
          $set: { policies: changes.approvalPolicies.policies, updatedBy: actor._id },
          $setOnInsert: { societyId: society._id },
        },
        { upsert: true, returnDocument: 'after', runValidators: true },
      );
    } else if (changes.notificationTemplates) {
      metadata = {
        section: 'notificationTemplates',
        templateKeys: changes.notificationTemplates.templates.map(({ key }) => key),
      };
      await NotificationTemplates.findOneAndUpdate(
        { societyId: society._id },
        {
          $set: {
            templates: changes.notificationTemplates.templates,
            updatedBy: actor._id,
          },
          $setOnInsert: { societyId: society._id },
        },
        { upsert: true, returnDocument: 'after', runValidators: true },
      );
    }

    await audit.record({
      actorId: actor._id,
      societyId: society._id,
      action: 'society.settings.update',
      targetType: 'society_configuration',
      targetId,
      outcome: 'success',
      requestId: request.id,
      metadata,
    });
    return getSocietySettings({
      society: await Society.findById(society._id).lean(),
      isAdmin: true,
    });
  }

  return { getSocietySettings, updateSocietySettings };
}

module.exports = { createSettingsService };
