function createAuditService({ AuditLog, clock = () => new Date() }) {
  async function record({
    actorId = null,
    societyId = null,
    action,
    targetType = null,
    targetId = null,
    outcome,
    requestId = null,
    metadata = {},
  }) {
    const safeMetadata = Object.fromEntries(
      Object.entries(metadata).filter(
        ([key]) => !/(password|token|secret|authorization|cookie|email)/i.test(key),
      ),
    );
    await AuditLog.create({
      actorId,
      societyId,
      action,
      targetType,
      targetId: targetId === null ? null : String(targetId),
      outcome,
      requestId,
      metadata: safeMetadata,
      occurredAt: clock(),
    });
  }

  return { record };
}

module.exports = { createAuditService };
