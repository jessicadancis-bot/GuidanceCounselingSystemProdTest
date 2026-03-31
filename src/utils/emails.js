const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

const sendEmail = async (to, subject, html) => {
  await resend.emails.send({
    from: "Guidance System <noreply@resend.dev>",
    to: process.env.ONBOARDING_EMAIL || to,
    subject,
    html,
  });
};

module.exports = { sendEmail };
