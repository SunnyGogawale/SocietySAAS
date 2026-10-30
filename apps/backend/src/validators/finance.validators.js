const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const amountMinor = z.number().int().min(1).max(100000000000);
const societyAndId = (name) => z.strictObject({ societyId: objectId, [name]: objectId });
const emptyBody = z.strictObject({});

const gatewaySchema = z.strictObject({
  keyId: z.string().trim().min(5).max(120),
  keySecret: z.string().min(8).max(256),
  webhookSecret: z.string().min(8).max(256),
});
const paymentSchema = z.strictObject({
  billId: objectId,
  amountMinor,
  idempotencyKey: z.string().trim().min(16).max(100),
});
const vendorSchema = z.strictObject({
  name: z.string().trim().min(2).max(160),
  contactName: z.string().trim().max(120).nullable().optional(),
  email: z.email().max(254).nullable().optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  taxIdentifier: z.string().trim().max(32).nullable().optional(),
});
const accountSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9_-]{2,24}$/i),
  name: z.string().trim().min(2).max(120),
  type: z.enum(['asset', 'liability', 'equity', 'income', 'expense']),
  reconciliationEnabled: z.boolean().default(false),
});
const expenseSchema = z.strictObject({
  vendorId: objectId,
  expenseAccountId: objectId,
  amountMinor,
  currency: z.string().regex(/^[A-Z]{3}$/),
  incurredAt: z.iso.datetime(),
  description: z.string().trim().min(2).max(240),
  reference: z.string().trim().max(120).nullable().optional(),
  supportingDocument: z.string().trim().max(500).nullable().optional(),
});
const vendorPaymentSchema = z.strictObject({
  amountMinor,
  paidAt: z.iso.datetime().optional(),
  method: z.enum(['cash', 'bank_transfer', 'cheque', 'other']),
  reference: z.string().trim().max(120).nullable().optional(),
});
const refundSchema = z.strictObject({
  amountMinor,
  reason: z.string().trim().min(5).max(500),
});
const expenseReversalSchema = z.strictObject({
  reason: z.string().trim().min(5).max(500),
});
const reportQuery = z.strictObject({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
});
const importStatementSchema = z
  .strictObject({
    accountId: objectId,
    sourceName: z.string().trim().min(1).max(120),
    csv: z.string().min(1).max(900000),
    mapping: z.strictObject({
      date: z.string().trim().min(1).max(100),
      description: z.string().trim().min(1).max(100),
      reference: z.string().trim().min(1).max(100),
      debit: z.string().trim().min(1).max(100),
      credit: z.string().trim().min(1).max(100),
      balance: z.string().trim().min(1).max(100),
    }),
  })
  .superRefine(({ mapping }, context) => {
    const headers = Object.values(mapping);
    if (new Set(headers).size !== headers.length) {
      context.addIssue({
        code: 'custom',
        path: ['mapping'],
        message: 'Each statement field must map to a distinct CSV column',
      });
    }
  });
const reconciliationQuery = z.strictObject({ importId: objectId.optional() });
const matchSchema = z.strictObject({ journalEntryId: objectId });
const settlementSchema = z.strictObject({
  bankAccountId: objectId,
  reference: z.string().trim().min(1).max(120),
  amountMinor,
  settledAt: z.iso.datetime(),
});

module.exports = {
  accountParams: societyAndId('accountId'),
  accountSchema,
  emptyBody,
  expenseParams: societyAndId('expenseId'),
  expenseSchema,
  expenseReversalSchema,
  gatewaySchema,
  importStatementSchema,
  matchParams: societyAndId('lineId'),
  matchSchema,
  paymentParams: societyAndId('paymentId'),
  paymentSchema,
  reconciliationQuery,
  refundParams: societyAndId('paymentId').extend({ refundId: objectId }),
  refundSchema,
  reportQuery,
  settlementSchema,
  societyParams: z.strictObject({ societyId: objectId }),
  vendorParams: societyAndId('vendorId'),
  vendorPaymentSchema,
  vendorPaymentParams: societyAndId('expenseId').extend({ vendorPaymentId: objectId }),
  vendorSchema,
};
