const { verifyFunctionArchive } = require("../../../scripts/verify-netlify-function-assets.cjs");

module.exports = {
 onPostBuild() {
    const assets = verifyFunctionArchive();
    console.log(
      `Verified packaged knowledge assets: ${assets.join(", ")}`,
    );
  },
};
