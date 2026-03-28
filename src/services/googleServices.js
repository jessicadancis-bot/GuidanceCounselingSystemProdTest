const { OAuth2Client } = require("google-auth-library");
const AppError = require("../utils/AppError");

const verifyGoogleToken = async (credential, audience) => {
  const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

  if (!credential) {
    throw new AppError("Credential cannot be empty!", 400);
  }
  if (!audience) {
    throw new Error();
  }

  try {
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: audience,
    });

    const payload = ticket.getPayload();

    return payload;
  } catch (e) {
    throw new AppError("Invalid Google token", 400);
  }
};

module.exports = { verifyGoogleToken };
