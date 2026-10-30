const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      unique: true,
    },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'SubscriptionPlan', required: true },
    status: {
      type: String,
      enum: ['trialing', 'active', 'past_due', 'suspended', 'canceled'],
      required: true,
    },
    trialEndsAt: { type: Date, default: null },
    currentPeriodEndsAt: { type: Date, default: null },
    limits: {
      maxMembers: { type: Number, min: 1, default: null },
      maxHomes: { type: Number, min: 1, default: null },
      maxStorageMb: { type: Number, min: 1, default: null },
    },
    configuredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, versionKey: false },
);

subscriptionSchema.index({ status: 1, trialEndsAt: 1 });
subscriptionSchema.index({ planId: 1 });

module.exports = mongoose.models.Subscription || mongoose.model('Subscription', subscriptionSchema);
