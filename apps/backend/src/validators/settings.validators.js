const { z } = require('zod');

const supportedCurrencies = new Set(Intl.supportedValuesOf('currency'));

const email = z
  .email()
  .max(254)
  .transform((value) => value.trim().toLowerCase());
const logoUrl = z
  .url()
  .max(2048)
  .refine((value) => new URL(value).protocol === 'https:', 'Logo URL must use HTTPS')
  .nullable();
const societyProfileSchema = z
  .strictObject({
    name: z.string().trim().min(2).max(160).optional(),
    address: z.string().trim().max(500).nullable().optional(),
    contactName: z.string().trim().min(2).max(120).nullable().optional(),
    contactEmail: email.nullable().optional(),
    contactPhone: z.string().trim().max(32).nullable().optional(),
    registrationNumber: z.string().trim().max(80).nullable().optional(),
    logoUrl: logoUrl.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one profile field must be provided');
const societySettingsSchema = z
  .strictObject({
    timeZone: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, 'Time zone must be a supported IANA time zone'),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/)
      .refine((value) => supportedCurrencies.has(value), 'Currency must be a supported ISO code'),
    areaUnit: z.enum(['square_foot', 'square_metre']).nullable().optional(),
    dateFormat: z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']),
    financialYearStartMonth: z.number().int().min(1).max(12),
    financialYearStartDay: z.number().int().min(1).max(31),
    numbering: z.strictObject({
      building: z.string().trim().min(1).max(40),
      wing: z.string().trim().min(1).max(40),
      flat: z.string().trim().min(1).max(40),
    }),
    visitorRules: z.strictObject({
      requirePreApproval: z.boolean(),
      maxVisitDaysAhead: z.number().int().min(0).max(365),
    }),
    complaintRules: z.strictObject({
      acknowledgmentHours: z.number().int().min(1).max(720),
      resolutionTargetHours: z.number().int().min(1).max(8760),
    }),
    notificationRules: z.strictObject({
      emailEnabled: z.boolean(),
      pushEnabled: z.boolean(),
      smsEnabled: z.boolean(),
    }),
    facilityBookingRules: z.strictObject({
      maxDaysAhead: z.number().int().min(0).max(365),
      requireApproval: z.boolean(),
      maxBookingsPerDay: z.number().int().min(1).max(100),
    }),
    branding: z.strictObject({
      primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    }),
  })
  .superRefine((value, context) => {
    const date = new Date(
      Date.UTC(2001, value.financialYearStartMonth - 1, value.financialYearStartDay),
    );
    if (
      date.getUTCMonth() !== value.financialYearStartMonth - 1 ||
      date.getUTCDate() !== value.financialYearStartDay
    ) {
      context.addIssue({
        code: 'custom',
        path: ['financialYearStartDay'],
        message: 'Financial year start day is not valid for the selected month',
      });
    }
    if (value.complaintRules.acknowledgmentHours > value.complaintRules.resolutionTargetHours) {
      context.addIssue({
        code: 'custom',
        path: ['complaintRules', 'acknowledgmentHours'],
        message: 'Acknowledgment target cannot exceed the resolution target',
      });
    }
  });
const chargeItemSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9_-]+$/),
  name: z.string().trim().min(2).max(120),
  calculation: z.enum(['fixed_per_home', 'per_area']),
  amountMinor: z.number().int().min(0).max(100000000000),
});
const chargeRulesSchema = z
  .strictObject({
    effectiveFrom: z.iso.datetime(),
    frequency: z.enum(['monthly', 'quarterly', 'half_yearly', 'yearly']),
    areaUnit: z.enum(['square_foot', 'square_metre']).nullable(),
    charges: z.array(chargeItemSchema).min(1).max(100),
    discounts: z
      .array(
        z.discriminatedUnion('calculation', [
          z.strictObject({
            code: z
              .string()
              .trim()
              .toLowerCase()
              .min(2)
              .max(64)
              .regex(/^[a-z0-9_-]+$/),
            name: z.string().trim().min(2).max(120),
            calculation: z.literal('fixed_per_home'),
            amountMinor: z.number().int().min(0).max(100000000000),
          }),
          z.strictObject({
            code: z
              .string()
              .trim()
              .toLowerCase()
              .min(2)
              .max(64)
              .regex(/^[a-z0-9_-]+$/),
            name: z.string().trim().min(2).max(120),
            calculation: z.literal('percentage'),
            rateBasisPoints: z.number().int().min(0).max(10000),
          }),
        ]),
      )
      .max(100)
      .optional(),
    dueDayOfPeriod: z.number().int().min(1).max(28),
    lateFee: z.discriminatedUnion('type', [
      z.strictObject({ type: z.literal('none') }),
      z.strictObject({
        type: z.literal('percentage'),
        rateBasisPoints: z.number().int().min(0).max(10000),
        capAmountMinor: z.number().int().min(0).max(100000000000),
      }),
    ]),
    gracePeriodDays: z.number().int().min(0).max(365),
  })
  .superRefine((value, context) => {
    const codes = value.charges.map(({ code }) => code);
    if (new Set(codes).size !== codes.length) {
      context.addIssue({
        code: 'custom',
        path: ['charges'],
        message: 'Charge codes must be unique',
      });
    }
    const discountCodes = (value.discounts ?? []).map(({ code }) => code);
    if (new Set(discountCodes).size !== discountCodes.length) {
      context.addIssue({
        code: 'custom',
        path: ['discounts'],
        message: 'Discount codes must be unique',
      });
    }
    if (value.charges.some(({ calculation }) => calculation === 'per_area') && !value.areaUnit) {
      context.addIssue({
        code: 'custom',
        path: ['areaUnit'],
        message: 'Choose a measurement unit when a charge is calculated per area',
      });
    }
  });
const approvalPoliciesSchema = z
  .strictObject({
    policies: z
      .array(
        z.strictObject({
          operation: z
            .string()
            .trim()
            .toLowerCase()
            .regex(/^[a-z][a-z0-9_]{1,63}$/),
          enabled: z.boolean(),
          requiredApprovals: z.number().int().min(1).max(10),
          amountThresholdMinor: z.number().int().min(0).max(100000000000).nullable(),
        }),
      )
      .max(20),
  })
  .superRefine((value, context) => {
    const operations = value.policies.map(({ operation }) => operation);
    if (new Set(operations).size !== operations.length) {
      context.addIssue({
        code: 'custom',
        path: ['policies'],
        message: 'Each operation can have only one approval policy',
      });
    }
  });
const notificationTemplatesSchema = z
  .strictObject({
    templates: z
      .array(
        z.strictObject({
          key: z
            .string()
            .trim()
            .toLowerCase()
            .min(2)
            .max(64)
            .regex(/^[a-z0-9_-]+$/),
          channel: z.enum(['email', 'sms', 'push']),
          subject: z.string().trim().max(160).default(''),
          body: z.string().trim().min(1).max(5000),
          enabled: z.boolean().default(true),
        }),
      )
      .max(100),
  })
  .superRefine((value, context) => {
    const keys = value.templates.map(({ key }) => key);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: 'custom',
        path: ['templates'],
        message: 'Template keys must be unique',
      });
    }
  });
const updateSettingsSchema = z
  .strictObject({
    profile: societyProfileSchema.optional(),
    settings: societySettingsSchema.optional(),
    chargeRules: chargeRulesSchema.optional(),
    approvalPolicies: approvalPoliciesSchema.optional(),
    notificationTemplates: notificationTemplatesSchema.optional(),
  })
  .refine((value) => Object.keys(value).length === 1, 'Update exactly one configuration section');

module.exports = { updateSettingsSchema };
