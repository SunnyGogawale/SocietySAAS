const mongoose = require('mongoose');

const paymentGatewayAccountSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      immutable: true,
      unique: true,
    },
    provider: { type: String, enum: ['razorpay'], required: true, default: 'razorpay' },
    keyId: { type: String, required: true },
    encryptedKeySecret: { type: String, required: true, select: false },
    encryptedWebhookSecret: { type: String, required: true, select: false },
    enabled: { type: Boolean, default: true },
    configuredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, versionKey: false },
);

module.exports =
  mongoose.models.PaymentGatewayAccount ||
  mongoose.model('PaymentGatewayAccount', paymentGatewayAccountSchema);
