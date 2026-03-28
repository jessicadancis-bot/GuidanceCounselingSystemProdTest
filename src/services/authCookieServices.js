const { cookieOptions } = require("../config/cookieConfig");

const setRefreshCookie = (res, token) => {
  res.cookie("refresh_token", token, cookieOptions);
};

const clearRefreshCookie = (res) => {
  res.clearCookie("refresh_token", {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
  });
};

module.exports = {
  setRefreshCookie,
  clearRefreshCookie
};
