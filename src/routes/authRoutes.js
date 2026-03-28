const express = require("express");
const {
  passwordLogInHandler,
  logOutHandler,
  requestPasswordResetHandler,
  resetPasswordHandler,
  changePasswordHandler,
  verifyAccountHandler,
  requestAccountVerificationHandler,
  googleLogInHandler,
  refreshTokenHandler,
} = require("../controllers/authController");
const { 
  requiresPermission,
  checkForRefreshToken
} = require("../middleware/authMiddleware");
const { PERMISSIONS } = require("../config/permissionsConfig");

const router = express.Router();

router.get("/", (req, res) => {
  return res.json("You have reached the api/auth path!");
});
router.get(
  "/refresh",
  checkForRefreshToken,
  refreshTokenHandler
);
router.post("/google", 
  googleLogInHandler
);
router.post("/login", 
  passwordLogInHandler
);
router.post("/logout", 
  logOutHandler
);
router.post(
  "/password/update",
  requiresPermission({permission : [PERMISSIONS.UPDATE_PASSWORD]}),
  changePasswordHandler
);
router.post("/password/reset/request", 
  requestPasswordResetHandler
);
router.patch("/password/reset", 
  resetPasswordHandler
);
router.patch("/activate", 
  verifyAccountHandler
);
router.post("/resend-activation", 
  requestAccountVerificationHandler
);

module.exports = router;
