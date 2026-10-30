const mongoose = require('mongoose');

const societySettingsSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      immutable: true,
    },
    chargeRulesVersion: { type: Number, select: false, min: 0 },
    chargeRulesEffectiveFrom: { type: Date, select: false },
    timeZone: { type: String, required: true, default: 'Asia/Kolkata', maxlength: 64 },
    currency: {
      type: String,
      required: true,
      default: 'INR',
      uppercase: true,
      minlength: 3,
      maxlength: 3,
    },
    areaUnit: { type: String, enum: ['square_foot', 'square_metre'], default: null },
    dateFormat: {
      type: String,
      enum: ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'],
      required: true,
      default: 'DD/MM/YYYY',
    },
    financialYearStartMonth: { type: Number, required: true, min: 1, max: 12, default: 4 },
    financialYearStartDay: { type: Number, required: true, min: 1, max: 31, default: 1 },
    numbering: {
      building: {
        type: String,
        required: true,
        trim: true,
        maxlength: 40,
        default: 'Building {number}',
      },
      wing: { type: String, required: true, trim: true, maxlength: 40, default: 'Wing {letter}' },
      flat: { type: String, required: true, trim: true, maxlength: 40, default: '{floor}{number}' },
    },
    visitorRules: {
      requirePreApproval: { type: Boolean, default: false },
      maxVisitDaysAhead: { type: Number, min: 0, max: 365, default: 30 },
    },
    complaintRules: {
      acknowledgmentHours: { type: Number, min: 1, max: 720, default: 24 },
      resolutionTargetHours: { type: Number, min: 1, max: 8760, default: 168 },
    },
    notificationRules: {
      emailEnabled: { type: Boolean, default: true },
      pushEnabled: { type: Boolean, default: true },
      smsEnabled: { type: Boolean, default: false },
    },
    facilityBookingRules: {
      maxDaysAhead: { type: Number, min: 0, max: 365, default: 30 },
      requireApproval: { type: Boolean, default: true },
      maxBookingsPerDay: { type: Number, min: 1, max: 100, default: 1 },
    },
    branding: {
      primaryColor: { type: String, default: '#142b4a', match: /^#[0-9a-fA-F]{6}$/ },
      accentColor: { type: String, default: '#2563eb', match: /^#[0-9a-fA-F]{6}$/ },
    },
  },
  { timestamps: true, versionKey: false },
);

societySettingsSchema.index({ societyId: 1 }, { unique: true });

module.exports =
  mongoose.models.SocietySettings || mongoose.model('SocietySettings', societySettingsSchema);
