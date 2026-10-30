const mongoose = require('mongoose');

const subscriptionPlanSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    code: { type: String, required: true, trim: true, lowercase: true, maxlength: 64 },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    limits: {
      maxMembers: { type: Number, min: 1, default: null },
      maxHomes: { type: Number, min: 1, default: null },
      maxStorageMb: { type: Number, min: 1, default: null },
    },
    priceMinor: { type: Number, min: 0, default: null },
    currency: { type: String, uppercase: true, minlength: 3, maxlength: 3, default: null },
    status: { type: String, enum: ['active', 'archived'], default: 'active', required: true },
  },
  { timestamps: true, versionKey: false },
);

subscriptionPlanSchema.index({ code: 1 }, { unique: true });
subscriptionPlanSchema.index({ status: 1, name: 1 });

module.exports =
  mongoose.models.SubscriptionPlan || mongoose.model('SubscriptionPlan', subscriptionPlanSchema);
