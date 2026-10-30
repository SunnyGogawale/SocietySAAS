const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const email = z
  .email()
  .max(254)
  .transform((value) => value.trim().toLowerCase());
const status = z.enum([
  'pending_review',
  'provisioning',
  'rejected',
  'active',
  'suspended',
  'archived',
]);
const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
};
const textSearch = z.string().trim().min(1).max(120).optional();

const registrationSchema = z.strictObject({
  name: z.string().trim().min(2).max(160),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  registrationNumber: z.string().trim().max(80).optional(),
  address: z.string().trim().max(500).optional(),
  contactName: z.string().trim().min(2).max(120),
  contactEmail: email,
  contactPhone: z.string().trim().max(32).optional(),
});

const societyListQuerySchema = z.strictObject({
  status: status.optional(),
  q: textSearch,
  sort: z.enum(['createdAt', 'name', 'status']).default('createdAt'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  ...pagination,
});
const auditQuerySchema = z.strictObject({
  societyId: objectId.optional(),
  action: z.string().trim().min(1).max(96).optional(),
  outcome: z.enum(['success', 'failure']).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  sort: z.enum(['occurredAt', 'action', 'outcome']).default('occurredAt'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  ...pagination,
});
const ticketQuerySchema = z.strictObject({
  status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
  q: textSearch,
  sort: z.enum(['updatedAt', 'createdAt', 'status', 'priority']).default('updatedAt'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  ...pagination,
});
const societyIdParamsSchema = z.strictObject({ societyId: objectId });
const ticketParamsSchema = z.strictObject({ ticketId: objectId });
const planParamsSchema = z.strictObject({ planId: objectId });

const limitsSchema = z.strictObject({
  maxMembers: z.number().int().min(1).nullable().default(null),
  maxHomes: z.number().int().min(1).nullable().default(null),
  maxStorageMb: z.number().int().min(1).nullable().default(null),
});
const planSchema = z
  .strictObject({
    name: z.string().trim().min(2).max(120),
    code: z
      .string()
      .trim()
      .toLowerCase()
      .min(2)
      .max(64)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    description: z.string().trim().max(1000).default(''),
    limits: limitsSchema.default({}),
    priceMinor: z.number().int().min(0).nullable().default(null),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/)
      .nullable()
      .default(null),
  })
  .superRefine((value, context) => {
    if (value.priceMinor !== null && value.currency === null) {
      context.addIssue({
        code: 'custom',
        path: ['currency'],
        message: 'Currency is required with a price',
      });
    }
  });
const updatePlanSchema = z
  .strictObject({
    name: z.string().trim().min(2).max(120).optional(),
    code: z
      .string()
      .trim()
      .toLowerCase()
      .min(2)
      .max(64)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
    description: z.string().trim().max(1000).optional(),
    limits: limitsSchema.partial().optional(),
    priceMinor: z.number().int().min(0).nullable().optional(),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/)
      .nullable()
      .optional(),
    status: z.enum(['active', 'archived']).optional(),
  })
  .superRefine((value, context) => {
    if (value.priceMinor !== undefined && value.priceMinor !== null && value.currency === null) {
      context.addIssue({
        code: 'custom',
        path: ['currency'],
        message: 'Currency is required with a price',
      });
    }
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field must be provided');
const approveSchema = z.strictObject({
  planId: objectId,
  trialDays: z.number().int().min(0).max(3650),
});
const rejectSchema = z.strictObject({ reason: z.string().trim().min(5).max(1000) });
const societyProfileSchema = z.strictObject({
  name: z.string().trim().min(2).max(160).optional(),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
  registrationNumber: z.string().trim().max(80).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
  contactName: z.string().trim().min(2).max(120).nullable().optional(),
  contactEmail: email.nullable().optional(),
  contactPhone: z.string().trim().max(32).nullable().optional(),
});
const societyStatusSchema = z.strictObject({ status: z.enum(['active', 'suspended', 'archived']) });
const primaryAdminSchema = z.strictObject({ membershipId: objectId });
const subscriptionSchema = z
  .strictObject({
    planId: objectId.optional(),
    status: z.enum(['trialing', 'active', 'past_due', 'suspended', 'canceled']).optional(),
    trialDays: z.number().int().min(0).max(3650).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field must be provided');
const createTicketSchema = z.strictObject({
  subject: z.string().trim().min(4).max(200),
  description: z.string().trim().min(10).max(10000),
  priority: z.enum(['normal', 'urgent']).default('normal'),
});
const updateTicketSchema = z.strictObject({
  status: z.enum(['open', 'in_progress', 'resolved', 'closed']),
  priority: z.enum(['normal', 'urgent']).optional(),
  assignedTo: objectId.nullable().optional(),
});

module.exports = {
  approveSchema,
  auditQuerySchema,
  createTicketSchema,
  planParamsSchema,
  planSchema,
  primaryAdminSchema,
  registrationSchema,
  rejectSchema,
  societyIdParamsSchema,
  societyListQuerySchema,
  societyProfileSchema,
  societyStatusSchema,
  subscriptionSchema,
  ticketParamsSchema,
  ticketQuerySchema,
  updatePlanSchema,
  updateTicketSchema,
};
