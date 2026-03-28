// Services
const {
  authenticateUserByEmail,
  changePassword,
  resetPassword,
  requestPasswordReset,
  verifyAccount,
  requestAccountVerification,
  authenticateUserByGoogleSub,
} = require("../services/authServices");
const {
  setRefreshCookie,
  clearRefreshCookie,
} = require("../services/authCookieServices");
const { ROLE } = require("../config/serverConstants");
const { generateToken } = require("../utils/Token");
const { sendEmail } = require("../utils/emails");

const googleLogInHandler = async (req, res, next) => {
  try {
    const account = await authenticateUserByGoogleSub({
      credential: req.body.credential,
    });

    clearRefreshCookie(res);
    setRefreshCookie(res, account.refresh_token);

    const role = account.role;
    
    return res.status(200).json({ role, access_token: account.token });
  } catch (e) {
    return next(e);
  }
};

const passwordLogInHandler = async (req, res, next) => {
  try {
    const account = await authenticateUserByEmail({
      email: req.body.email,
      password: req.body.password,
    });

    clearRefreshCookie(res);
    setRefreshCookie(res, account.refresh_token);

    const role = account.role;

    return res.status(200).json({ role, access_token: account.token });
  } catch (e) {
    return next(e);
  }
};

const changePasswordHandler = async (req, res, next) => {
  try {
    await changePassword(
      req.user?.accountId,
      req.body.current_password,
      req.body.new_password,
    );
    
    return res.status(200).json({ message: "Password updated successfully" });
  } catch (e) {
    return next(e);
  }
};

const resetPasswordHandler = async (req, res, next) => {
  try {
    await resetPassword({ 
      reset_token: req.query.token, 
      new_password: req.body.new_password
    });

    return res.status(200).json({ message: "Password reset successful" });
  } catch (e) {
    return next(e);
  }
};

const requestPasswordResetHandler = async (req, res, next) => {
  try {
    const results = await requestPasswordReset({ account_email: req.body.email });

    const resetLink = `${process.env.PASSWORD_RESET_URL}?token=${results.reset_token}`;
    try {
      await sendEmail(
        process.env.SMTP_USER || results?.email,
        "Password Reset",
        `Click this link to reset your password (expires in 15 minutes): ${resetLink}`
      );
    } catch (e) {
      return res.status(200).json({ message: "Request processed, but failed to send the email. Please try resending." });
    }

    return res
      .status(200)
      .json({ message: "Email for the password request has been sent!" });
  } catch (e) {
    return next(e);
  }
};

const logOutHandler = (req, res) => {
  res.clearCookie("refresh_token", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
  });

  return res.status(200).json({ message: "Logged out successfully" });
};

const verifyAccountHandler = async (req, res, next) => {
  try {
    await verifyAccount({
      token: req.body.token,
    });

    return res.status(204).send();
  } catch (e) {
    return next(e);
  }
};

const requestAccountVerificationHandler = async (req, res, next) => {
  try {
    await requestAccountVerification({ email: req.body.email });

    return res
      .status(200)
      .json({ message: "Activation mail have been sent to your account" });
  } catch (e) {
    return next(e);
  }
};

const refreshTokenHandler = async (req, res, next) => {
  try {
    const token = await generateToken({
      accountId: req.user?.accountId || 0,
      role: req.user?.role || 0,
      permissions: req.user.permissions
    });

    return res.status(200).json({ access_token: token });
  } catch (e) {
    return next(e);
  }
};

module.exports = {
  passwordLogInHandler,
  googleLogInHandler,
  logOutHandler,
  changePasswordHandler,
  resetPasswordHandler,
  requestPasswordResetHandler,
  verifyAccountHandler,
  requestAccountVerificationHandler,
  refreshTokenHandler
};
