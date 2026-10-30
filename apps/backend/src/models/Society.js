const mongoose = require('mongoose');

const societySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 80 },
    registrationNumber: { type: String, trim: true, maxlength: 80, default: null },
    address: { type: String, trim: true, maxlength: 500, default: null },
    logoUrl: { type: String, trim: true, maxlength: 2048, default: null },
    contactName: { type: String, trim: true, maxlength: 120, default: null },
    contactEmail: { type: String, trim: true, lowercase: true, maxlength: 254, default: null },
    contactPhone: { type: String, trim: true, maxlength: 32, default: null },
    primaryAdminMembershipId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SocietyMembership',
      default: null,
    },
    status: {
      type: String,
      enum: ['pending_review', 'provisioning', 'rejected', 'active', 'suspended', 'archived'],
      default: 'pending_review',
      required: true,
    },
    rejectionReason: { type: String, trim: true, maxlength: 1000, default: null },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

societySchema.index({ slug: 1 }, { unique: true });
societySchema.index({ status: 1, createdAt: -1 });
societySchema.index({ contactEmail: 1 });

module.exports = mongoose.models.Society || mongoose.model('Society', societySchema);
