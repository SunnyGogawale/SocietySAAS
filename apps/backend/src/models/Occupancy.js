const mongoose = require('mongoose');

const occupancySchema = new mongoose.Schema(
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
      default: null,
      immutable: true,
    },
    residentType: {
      type: String,
      enum: ['tenant', 'authorized_occupant', 'owner'],
      required: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, trim: true, lowercase: true, maxlength: 254, default: null },
    phone: { type: String, trim: true, maxlength: 32, default: null },
    leaseReference: { type: String, trim: true, maxlength: 120, default: null },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, default: null },
    status: { type: String, enum: ['active', 'ended'], default: 'active', required: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
    },
  },
  { timestamps: true, versionKey: false },
);

occupancySchema.index({ societyId: 1, flatId: 1, status: 1 });
occupancySchema.index({ societyId: 1, membershipId: 1, status: 1 });

module.exports = mongoose.models.Occupancy || mongoose.model('Occupancy', occupancySchema);
