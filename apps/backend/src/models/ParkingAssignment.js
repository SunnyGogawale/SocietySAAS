const mongoose = require('mongoose');

const parkingAssignmentSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      immutable: true,
    },
    parkingSlotId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ParkingSlot',
      required: true,
      immutable: true,
    },
    flatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Flat', required: true, immutable: true },
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vehicle',
      required: true,
      immutable: true,
    },
    startsAt: { type: Date, required: true, default: Date.now },
    endsAt: { type: Date, default: null },
    status: { type: String, enum: ['active', 'ended'], default: 'active', required: true },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
    },
  },
  { timestamps: true, versionKey: false },
);

parkingAssignmentSchema.index(
  { societyId: 1, parkingSlotId: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } },
);
parkingAssignmentSchema.index(
  { societyId: 1, vehicleId: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } },
);

module.exports =
  mongoose.models.ParkingAssignment || mongoose.model('ParkingAssignment', parkingAssignmentSchema);
