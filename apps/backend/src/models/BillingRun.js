const mongoose = require('mongoose');

const billingRunSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      immutable: true,
    },
    periodStart: { type: Date, required: true, immutable: true },
    periodEnd: { type: Date, required: true, immutable: true },
    revision: { type: Number, required: true, min: 1, immutable: true },
    source: { type: String, enum: ['recurring', 'revision'], required: true, immutable: true },
    status: {
      type: String,
      enum: ['draft', 'in_review', 'approved', 'issued', 'cancelled'],
      default: 'draft',
      required: true,
    },
    chargeRulesId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChargeRules', required: true },
    chargeRuleVersion: { type: Number, required: true },
    currency: { type: String, required: true, uppercase: true },
    billIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MaintenanceBill' }],
    preview: {
      flatCount: { type: Number, default: 0 },
      billCount: { type: Number, default: 0 },
      skippedFlatCount: { type: Number, default: 0 },
      subtotalMinor: { type: Number, default: 0 },
      discountMinor: { type: Number, default: 0 },
      totalMinor: { type: Number, default: 0 },
      skipped: [{ flatId: mongoose.Schema.Types.ObjectId, reason: String }],
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    issuedAt: { type: Date, default: null },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String, trim: true, maxlength: 500, default: null },
  },
  { timestamps: true, versionKey: false },
);

billingRunSchema.index(
  { societyId: 1, periodStart: 1, periodEnd: 1, revision: 1 },
  { unique: true },
);

module.exports = mongoose.models.BillingRun || mongoose.model('BillingRun', billingRunSchema);
