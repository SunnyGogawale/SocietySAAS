const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tokenHash: { type: String, required: true, unique: true, select: false },
    csrfTokenHash: { type: String, required: true, select: false },
    transport: { type: String, enum: ['cookie', 'bearer'], required: true },
    activeSocietyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      default: null,
    },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    lastUsedAt: { type: Date, default: Date.now },
    userAgent: { type: String, maxlength: 512, default: '' },
  },
  { timestamps: true, versionKey: false },
);

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.Session || mongoose.model('Session', sessionSchema);
