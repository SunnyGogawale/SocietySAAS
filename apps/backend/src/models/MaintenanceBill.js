const mongoose = require('mongoose');

const maintenanceBillSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      immutable: true,
    },
    flatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Flat', required: true, immutable: true },
    billingRunId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BillingRun',
      default: null,
      immutable: true,
    },
    periodStart: { type: Date, required: true, immutable: true },
    periodEnd: { type: Date, required: true, immutable: true },
    dueDate: { type: Date, required: true, immutable: true },
    revision: { type: Number, required: true, min: 1, immutable: true },
    source: {
      type: String,
      enum: ['recurring', 'revision', 'ad_hoc', 'opening_balance'],
      required: true,
      immutable: true,
    },
    status: {
      type: String,
      enum: ['draft', 'in_review', 'approved', 'issued', 'cancelled'],
      default: 'draft',
      required: true,
    },
    activePeriodKey: { type: String, default: null },
    invoiceNumber: { type: String, default: null },
    currency: { type: String, required: true, uppercase: true, immutable: true },
    chargeRulesId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChargeRules', default: null },
    chargeRuleVersion: { type: Number, default: null },
    calculationSnapshot: {
      flatArea: { type: Number, required: true },
      flatAreaUnit: { type: String, required: true },
      ownershipDays: { type: Number, required: true },
      periodDays: { type: Number, required: true },
      ownerMembershipIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'SocietyMembership' }],
      chargeRules: { type: mongoose.Schema.Types.Mixed, default: null },
    },
    ownerMembershipIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'SocietyMembership' }],
    subtotalMinor: { type: Number, required: true, min: 0 },
    discountMinor: { type: Number, required: true, min: 0, default: 0 },
    totalMinor: { type: Number, required: true, min: 0 },
    reason: { type: String, trim: true, maxlength: 500, default: null },
    sourceReference: { type: String, trim: true, maxlength: 120, default: null },
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

maintenanceBillSchema.index(
  { societyId: 1, flatId: 1, activePeriodKey: 1 },
  { unique: true, partialFilterExpression: { activePeriodKey: { $type: 'string' } } },
);
maintenanceBillSchema.index(
  { societyId: 1, invoiceNumber: 1 },
  { unique: true, partialFilterExpression: { invoiceNumber: { $type: 'string' } } },
);
maintenanceBillSchema.index({ societyId: 1, status: 1, periodStart: -1 });
maintenanceBillSchema.index({ societyId: 1, flatId: 1, dueDate: 1, status: 1 });
maintenanceBillSchema.index({ societyId: 1, ownerMembershipIds: 1, status: 1 });
maintenanceBillSchema.index(
  { societyId: 1, flatId: 1, sourceReference: 1 },
  {
    unique: true,
    partialFilterExpression: { source: 'opening_balance', sourceReference: { $type: 'string' } },
  },
);

module.exports =
  mongoose.models.MaintenanceBill || mongoose.model('MaintenanceBill', maintenanceBillSchema);
