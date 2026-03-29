const rate_limit = require("express-rate-limit");

const useLimiter = ({ seconds, max, message }) => {
    return refresh_limiter  = rate_limit({
        windowMs: seconds * 1000,
        max: max || 1,
        message: message || "Too many refresh attempts. Try again later."
    });
};

module.exports = { useLimiter };