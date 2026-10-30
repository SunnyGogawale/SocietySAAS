const { z } = require('zod');

const emailSchema = z
  .email()
  .max(254)
  .transform((email) => email.trim().toLowerCase());
const passwordSchema = z.string().min(12).max(128);
const emptyObject = z.strictObject({}).default({});

const loginSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

const forgotPasswordSchema = z.strictObject({ email: emailSchema });
const resetPasswordSchema = z.strictObject({
  token: z.string().min(32).max(128),
  password: passwordSchema,
});
const verifyEmailSchema = z.strictObject({ token: z.string().min(32).max(128) });
const acceptInvitationSchema = z.strictObject({
  token: z.string().min(32).max(128),
  password: passwordSchema.optional(),
  displayName: z.string().trim().min(2).max(120).optional(),
});
const updateProfileSchema = z
  .strictObject({
    displayName: z.string().trim().min(2).max(120).optional(),
    phone: z.union([z.string().trim().max(32), z.literal('')]).optional(),
  })
  .refine((value) => value.displayName !== undefined || value.phone !== undefined, {
    message: 'At least one profile field must be provided',
  });
const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
const societyIdParamsSchema = z.strictObject({ societyId: objectIdSchema });
const idParamsSchema = z.strictObject({
  societyId: objectIdSchema,
  membershipId: objectIdSchema,
});

module.exports = {
  acceptInvitationSchema,
  emptyObject,
  forgotPasswordSchema,
  idParamsSchema,
  loginSchema,
  resetPasswordSchema,
  societyIdParamsSchema,
  updateProfileSchema,
  verifyEmailSchema,
};
