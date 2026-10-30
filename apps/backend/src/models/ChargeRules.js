const mongoose = require('mongoose');

const chargeItemSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true, lowercase: true, maxlength: 64 },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    calculation: { type: String, enum: ['fixed_per_home', 'per_area'], required: true },
    amountMinor: { type: Number, min: 0, default: null },
  },
  { _id: false },
);

const chargeRulesSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      immutable: true,
    },
    version: { type: Number, required: true, min: 1, immutable: true },
    effectiveFrom: { type: Date, required: true, immutable: true },
    frequency: {
      type: String,
      enum: ['monthly', 'quarterly', 'half_yearly', 'yearly'],
      required: true,
      immutable: true,
    },
    areaUnit: {
      type: String,
      enum: ['square_foot', 'square_metre'],
      default: null,
      immutable: true,
    },
    charges: { type: [chargeItemSchema], required: true, immutable: true },
    dueDayOfPeriod: { type: Number, required: true, min: 1, max: 28, immutable: true },
    lateFee: {
      type: {
        type: String,
        enum: ['none', 'fixed', 'percentage'],
        required: true,
        immutable: true,
      },
      amountMinor: { type: Number, min: 0, default: null, immutable: true },
      rateBasisPoints: { type: Number, min: 0, max: 10000, default: null, immutable: true },
    },
    gracePeriodDays: { type: Number, required: true, min: 0, max: 365, immutable: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
    },
  },
  { timestamps: true, versionKey: false },
);

chargeRulesSchema.index({ societyId: 1, version: 1 }, { unique: true });
chargeRulesSchema.index({ societyId: 1, effectiveFrom: -1, version: -1 });

module.exports = mongoose.models.ChargeRules || mongoose.model('ChargeRules', chargeRulesSchema);
