const nodemailer = require('nodemailer');
const config = require('./config');

let transporter = null;

function getTransporter() {
  if (!config.email.enabled || !config.email.host || !config.email.user) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.secure,
      auth: { user: config.email.user, pass: config.email.pass },
    });
  }
  return transporter;
}

/**
 * Send invoice email with payment link in body and PDF attached.
 * @param {object} opts
 * @param {string} opts.to - Recipient email
 * @param {string} opts.docNumber - Invoice number (e.g. "1001")
 * @param {string} opts.paymentLink - Wayl payment URL
 * @param {Buffer|ArrayBuffer} opts.pdfBuffer - Invoice PDF buffer
 * @returns {Promise<boolean>}
 */
async function sendInvoiceEmail(opts) {
  const transport = getTransporter();
  if (!transport) return false;

  const { to, docNumber, paymentLink, pdfBuffer } = opts;
  const html = `
    <p>Please find your invoice ${docNumber} attached.</p>
    <p><strong>Pay online via Wayl:</strong></p>
    <p><a href="${paymentLink}" style="word-break:break-all;">${paymentLink}</a></p>
    <p>رابط الدفع عبر Wayl:</p>
    <p><a href="${paymentLink}" style="word-break:break-all;">${paymentLink}</a></p>
  `.trim();

  const pdfNode = Buffer.isBuffer(pdfBuffer)
    ? pdfBuffer
    : Buffer.from(pdfBuffer);

  await transport.sendMail({
    from: config.email.from,
    to,
    subject: `Invoice ${docNumber}`,
    html,
    attachments: [{ filename: `invoice-${docNumber}.pdf`, content: pdfNode }],
  });

  return true;
}

module.exports = {
  isEnabled: () => config.email.enabled,
  sendInvoiceEmail,
};
