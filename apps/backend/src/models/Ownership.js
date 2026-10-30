const mongoose = require('mongoose');

const ownershipSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      immutable: true,
    },
    flatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Flat', required: true, immutable: true },
    membershipId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SocietyMembership',
      required: true,
      immutable: true,
    },
    ownershipType: { type: String, enum: ['owner', 'co_owner'], required: true },
    status: {
      type: String,
      enum: ['invited', 'active', 'ended'],
      required: true,
      default: 'invited',
    },
    startsAt: { type: Date, required: true, default: Date.now },
    endsAt: { type: Date, default: null },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
    },
  },
  { timestamps: true, versionKey: false },
);

ownershipSchema.index(
  { societyId: 1, flatId: 1, membershipId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['invited', 'active'] } } },
);
ownershipSchema.index({ societyId: 1, membershipId: 1, status: 1 });

module.exports = mongoose.models.Ownership || mongoose.model('Ownership', ownershipSchema);
