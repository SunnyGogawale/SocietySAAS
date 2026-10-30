const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Date must be a valid calendar date');
const amountMinor = z.number().int().min(1).max(100000000000);
const page = z.coerce.number().int().min(1).default(1);
const limit = z.coerce.number().int().min(1).max(100).default(20);

const societyAndIdParams = (name) => z.strictObject({ societyId: objectId, [name]: objectId });
const runActionParams = societyAndIdParams('runId').extend({
  action: z.enum(['review', 'approve', 'issue']),
});
const billActionParams = societyAndIdParams('billId').extend({
  action: z.enum(['review', 'approve', 'issue']),
});
const adjustmentActionParams = societyAndIdParams('adjustmentId').extend({
  action: z.enum(['approve', 'issue']),
});

const recurringRunSchema = z.strictObject({
  periodStart: dateOnly,
  periodEnd: dateOnly,
});

const standaloneBillSchema = z.strictObject({
  flatId: objectId,
  amountMinor,
  description: z.string().trim().min(2).max(200),
  reason: z.string().trim().min(5).max(500),
  dueDate: dateOnly,
  periodStart: dateOnly.optional(),
  periodEnd: dateOnly.optional(),
});

const openingBalanceSchema = z.strictObject({
  flatId: objectId,
  amountMinor,
  description: z.string().trim().min(2).max(200),
  reason: z.string().trim().min(5).max(500),
  dueDate: dateOnly,
  sourceReference: z.string().trim().min(1).max(120),
  periodStart: dateOnly.optional(),
  periodEnd: dateOnly.optional(),
});
const openingBalanceImportSchema = z
  .strictObject({
    sourceReference: z.string().trim().min(1).max(120),
    sourceTotalMinor: z.number().int().min(1).max(1000000000000),
    rows: z
      .array(
        z.strictObject({
          flatId: objectId,
          amountMinor,
          description: z.string().trim().min(2).max(200),
          reason: z.string().trim().min(5).max(500),
          dueDate: dateOnly,
        }),
      )
      .min(1)
      .max(500),
  })
  .superRefine((value, context) => {
    const flatIds = value.rows.map(({ flatId }) => flatId);
    if (new Set(flatIds).size !== flatIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['rows'],
        message: 'A flat can only occur once in an opening-balance import',
      });
    }
    if (value.rows.reduce((total, row) => total + row.amountMinor, 0) !== value.sourceTotalMinor) {
      context.addIssue({
        code: 'custom',
        path: ['sourceTotalMinor'],
        message: 'Imported rows must reconcile exactly to the verified source total',
      });
    }
  });

const revisionItemSchema = z.strictObject({
  code: z.string().trim().min(1).max(64),
  description: z.string().trim().min(2).max(200),
  category: z.enum(['maintenance', 'ad_hoc', 'discount', 'opening_balance']),
  calculation: z.enum(['fixed_per_home', 'per_area', 'manual', 'opening_balance']),
  rateMinor: z.number().int().min(0).max(100000000000),
  quantity: z.number().min(0).max(1000000),
  amountMinor,
  discount: z.boolean().default(false),
  reason: z.string().trim().max(500).nullable().optional(),
});

const creditNoteSchema = z.strictObject({
  direction: z.enum(['credit', 'debit']),
  category: z.enum(['adjustment', 'discount', 'penalty']),
  amountMinor,
  reason: z.string().trim().min(5).max(500),
});

const receiptSchema = z
  .strictObject({
    flatId: objectId,
    payerMembershipId: objectId,
    idempotencyKey: z.string().trim().min(16).max(100).optional(),
    amountMinor,
    receivedAt: z.iso.datetime().optional(),
    method: z.enum(['cash', 'bank_transfer', 'cheque', 'other']),
    reference: z.string().trim().max(120).nullable().optional(),
    allocations: z
      .array(z.strictObject({ billId: objectId, amountMinor }))
      .max(100)
      .optional(),
    reason: z.string().trim().max(500).nullable().optional(),
  })
  .superRefine((value, context) => {
    if (value.allocations?.length) {
      const billIds = value.allocations.map(({ billId }) => billId);
      if (new Set(billIds).size !== billIds.length) {
        context.addIssue({
          code: 'custom',
          path: ['allocations'],
          message: 'A bill can only appear once in receipt allocations',
        });
      }
    }
  });

const cancelBillSchema = z.strictObject({
  reason: z.string().trim().min(5).max(500),
});
const revisionSchema = z.strictObject({
  reason: z.string().trim().min(5).max(500),
  items: z.array(revisionItemSchema).min(1).max(100).optional(),
});
const reminderSchema = z.strictObject({
  daysAhead: z.number().int().min(0).max(90).default(7),
});
const listBillsQuery = z.strictObject({
  status: z.enum(['draft', 'in_review', 'approved', 'issued', 'cancelled']).optional(),
  flatId: objectId.optional(),
  page,
  limit,
});
const markReminderParams = societyAndIdParams('reminderId');
const billParams = societyAndIdParams('billId');
const runParams = societyAndIdParams('runId');
const adjustmentParams = societyAndIdParams('adjustmentId');
const emptyBody = z.strictObject({});

module.exports = {
  adjustmentParams,
  adjustmentActionParams,
  billActionParams,
  billParams,
  cancelBillSchema,
  creditNoteSchema,
  emptyBody,
  listBillsQuery,
  markReminderParams,
  openingBalanceSchema,
  openingBalanceImportSchema,
  receiptSchema,
  recurringRunSchema,
  reminderSchema,
  revisionSchema,
  runParams,
  runActionParams,
  societyAndIdParams,
  standaloneBillSchema,
};
