const { env } = require("../config/env");

async function sendPasswordResetEmail({ to, name, token }) {
  const resetUrl = `${env.passwordResetUrl}?token=${encodeURIComponent(token)}`;
  const subject = "Reset your CollabBoard password";
  const text = `Hi ${name},\n\nReset your CollabBoard password using this link:\n${resetUrl}\n\nThis link expires in 30 minutes. If you did not request this, you can ignore this email.`;

  if (!env.resendApiKey) {
    if (env.isProd) throw new Error("Password reset email is not configured");
    console.info(`[password-reset] ${to}: ${resetUrl}`);
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.mailFrom, to: [to], subject, text }),
  });
  if (!response.ok) throw new Error("Password reset email could not be sent");
}

module.exports = { sendPasswordResetEmail };
