const { ROLE } = require("./serverConstants");

const SESSION_TIME_RANGE = {
    from: 8,
    to: 18
};

const ROLE_REDIRECTS = {
  [ROLE.ADMIN]: "/admin",
  [ROLE.COUNSELOR]: "/counselor",
  [ROLE.SYS_ADMIN]: "/sysadmin",
  [ROLE.CLIENT]: "/client",
};

module.exports = {
    SESSION_TIME_RANGE,
    ROLE_REDIRECTS
}

