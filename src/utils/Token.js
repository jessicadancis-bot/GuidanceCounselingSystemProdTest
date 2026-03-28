const jwt = require("jsonwebtoken");

const generateToken = async (content, expires_at) => {
  // create jsonwebtoken for authentication use
  const auth_token = jwt.sign(content || {}, process.env.JWT_SECRET, {
    expiresIn: expires_at || "15m",
  });

  if (!auth_token) {
    throw new AppError("Server or database error!", 500);
  }

  return auth_token;
};

module.exports = { generateToken };
