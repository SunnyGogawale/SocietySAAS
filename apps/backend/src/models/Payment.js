const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      immutable: true,
    },
    flatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Flat', required: true, immutable: true },
    payerMembershipId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SocietyMembership',
      required: true,
      immutable: true,
    },
    amountMinor: { type: Number, required: true, min: 1, immutable: true },
    currency: { type: String, required: true, uppercase: true, immutable: true },
    method: {
      type: String,
      enum: ['manual', 'online', 'upi', 'card', 'netbanking'],
      required: true,
    },
    status: {
      type: String,
      enum: [
        'pending',
        'processing',
        'captured',
        'failed',
        'refund_pending',
        'refunded',
        'reversed',
      ],
      default: 'pending',
      required: true,
    },
    provider: { type: String, enum: ['manual', 'razorpay'], required: true, immutable: true },
    providerReference: { type: String, default: null },
    checkoutUrl: { type: String, default: null, select: false },
    billId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MaintenanceBill',
      default: null,
      immutable: true,
    },
    providerPaymentId: { type: String, default: null },
    providerRefundId: { type: String, default: null },
    receiptId: { type: mongoose.Schema.Types.ObjectId, ref: 'Receipt', default: null },
    failureCode: { type: String, default: null },
    failureDescription: { type: String, default: null },
    capturedAt: { type: Date, default: null },
    refundedMinor: { type: Number, min: 0, default: 0 },
    refundStatus: {
      type: String,
      enum: ['none', 'pending', 'approved', 'processed', 'failed'],
      default: 'none',
    },
    refunds: [
      {
        amountMinor: { type: Number, min: 1, required: true },
        reason: { type: String, trim: true, maxlength: 500, required: true },
        status: {
          type: String,
          enum: ['pending', 'approved', 'processing', 'processed', 'failed'],
          default: 'pending',
        },
        requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        requestedAt: { type: Date, required: true },
        approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        approvedAt: { type: Date, default: null },
        processedAt: { type: Date, default: null },
        providerRefundId: { type: String, default: null },
      },
    ],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    idempotencyKey: { type: String, required: true, immutable: true },
  },
  { timestamps: true, versionKey: false },
);

paymentSchema.index({ societyId: 1, idempotencyKey: 1 }, { unique: true });
paymentSchema.index({ societyId: 1, flatId: 1, createdAt: -1 });
paymentSchema.index(
  { societyId: 1, providerReference: 1 },
  { unique: true, partialFilterExpression: { providerReference: { $type: 'string' } } },
);
paymentSchema.index(
  { societyId: 1, providerPaymentId: 1 },
  { unique: true, partialFilterExpression: { providerPaymentId: { $type: 'string' } } },
);

module.exports = mongoose.models.Payment || mongoose.model('Payment', paymentSchema);
