const nodemailer = require('nodemailer');
const { AppError } = require('../utils/AppError');

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}

function createEmailService({ config, logger, transport }) {
  const mailTransport =
    transport ??
    (config.smtp
      ? nodemailer.createTransport({
          host: config.smtp.host,
          port: config.smtp.port,
          secure: config.smtp.secure,
          auth: { user: config.smtp.user, pass: config.smtp.password },
        })
      : null);

  async function send({ to, subject, text, html }) {
    if (!mailTransport) {
      throw new AppError(503, 'email_delivery_unavailable', 'Email delivery is not configured');
    }

    try {
      await mailTransport.sendMail({
        from: config.emailFrom,
        to,
        subject,
        text,
        html,
      });
    } catch {
      logger.error(
        { event: 'auth_email_delivery_failed' },
        'Authentication email could not be sent',
      );
      throw new AppError(503, 'email_delivery_failed', 'Authentication email could not be sent');
    }
    logger.info({ event: 'email_sent' }, 'Authentication email delivered');
  }

  async function verifyConnection() {
    if (mailTransport) await mailTransport.verify();
  }

  async function sendInvitation({ to, token, societyName, role }) {
    const url = `${config.webAppUrl}/accept-invitation?token=${encodeURIComponent(token)}`;
    const safeSociety = escapeHtml(societyName);
    const safeRole = escapeHtml(role);
    await send({
      to,
      subject: `Invitation to join ${societyName}`,
      text: `You have been invited to join ${societyName} as ${role}. Accept the invitation: ${url}`,
      html: `<p>You have been invited to join <strong>${safeSociety}</strong> as ${safeRole}.</p><p><a href="${url}">Accept invitation</a></p>`,
    });
  }

  async function sendPasswordReset({ to, token }) {
    const url = `${config.webAppUrl}/reset-password?token=${encodeURIComponent(token)}`;
    await send({
      to,
      subject: 'Reset your SocietySAAS password',
      text: `Use this link to reset your password. This link expires soon: ${url}`,
      html: `<p>Use this link to reset your password. This link expires soon:</p><p><a href="${url}">Reset password</a></p>`,
    });
  }

  async function sendEmailVerification({ to, token }) {
    const url = `${config.webAppUrl}/verify-email?token=${encodeURIComponent(token)}`;
    await send({
      to,
      subject: 'Verify your SocietySAAS email',
      text: `Verify your email address: ${url}`,
      html: `<p>Verify your email address:</p><p><a href="${url}">Verify email</a></p>`,
    });
  }

  return {
    available: Boolean(mailTransport),
    sendEmailVerification,
    sendInvitation,
    sendPasswordReset,
    verifyConnection,
  };
}

module.exports = { createEmailService };
