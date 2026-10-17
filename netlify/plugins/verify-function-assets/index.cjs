const { verifyFunctionArchive } = require("../../../scripts/verify-netlify-function-assets.cjs");

module.exports = {
  onEnd() {
    const assets = verifyFunctionArchive();
    console.log(
      `Verified packaged knowledge assets: ${assets.join(", ")}`,
    );
  },
};
