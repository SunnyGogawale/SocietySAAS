const mongoose = require('mongoose');

const societyMembershipSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ['society_admin', 'house_owner'],
      required: true,
    },
    status: {
      type: String,
      enum: ['invited', 'pending_verification', 'active', 'suspended', 'revoked', 'expired'],
      default: 'invited',
      required: true,
    },
    permissions: { type: [String], default: [] },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    verifiedAt: { type: Date, default: null },
    invitationTokenHash: { type: String, select: false, default: null },
    invitationExpiresAt: { type: Date, select: false, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

societyMembershipSchema.index({ societyId: 1, userId: 1 }, { unique: true });
societyMembershipSchema.index({ invitationTokenHash: 1 }, { sparse: true });

module.exports =
  mongoose.models.SocietyMembership || mongoose.model('SocietyMembership', societyMembershipSchema);
