const mongoose = require('mongoose');

const parkingSlotSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      immutable: true,
    },
    buildingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Building',
      required: true,
      immutable: true,
    },
    flatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Flat', default: null },
    slotNumber: { type: String, required: true, trim: true, uppercase: true, maxlength: 32 },
    location: { type: String, trim: true, maxlength: 120, default: '' },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
  },
  { timestamps: true, versionKey: false },
);

parkingSlotSchema.index({ societyId: 1, buildingId: 1, slotNumber: 1 }, { unique: true });

module.exports = mongoose.models.ParkingSlot || mongoose.model('ParkingSlot', parkingSlotSchema);
