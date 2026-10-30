const { z } = require('zod');

const emailSchema = z
  .email()
  .max(254)
  .transform((email) => email.trim().toLowerCase());

const inviteAdminSchema = z.strictObject({ email: emailSchema });
const inviteOwnerSchema = z.strictObject({ email: emailSchema });
const memberListQuerySchema = z.strictObject({
  status: z
    .enum(['invited', 'pending_verification', 'active', 'suspended', 'revoked', 'expired'])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
const updateMembershipSchema = z.strictObject({
  status: z.enum(['active', 'suspended', 'revoked']),
});
const updateMembershipRoleSchema = z.strictObject({
  role: z.enum(['society_admin', 'house_owner']),
});

module.exports = {
  inviteAdminSchema,
  inviteOwnerSchema,
  memberListQuerySchema,
  updateMembershipRoleSchema,
  updateMembershipSchema,
};
