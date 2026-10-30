const mongoose = require('mongoose');

const paymentWebhookEventSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      immutable: true,
    },
    provider: { type: String, enum: ['razorpay'], required: true, immutable: true },
    eventId: { type: String, required: true, immutable: true },
    eventType: { type: String, required: true, immutable: true },
    processedAt: { type: Date, default: null },
    outcome: {
      type: String,
      enum: ['processing', 'processed', 'ignored', 'failed'],
      default: 'processing',
    },
  },
  { timestamps: true, versionKey: false },
);

paymentWebhookEventSchema.index({ societyId: 1, provider: 1, eventId: 1 }, { unique: true });

module.exports =
  mongoose.models.PaymentWebhookEvent ||
  mongoose.model('PaymentWebhookEvent', paymentWebhookEventSchema);
