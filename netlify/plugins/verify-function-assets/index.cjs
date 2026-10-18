const { verifyFunctionArchive } = require("../../../scripts/verify-netlify-function-assets.cjs");

module.exports = {
  onPostBuild({ constants }) {
    const functionsDist = constants?.FUNCTIONS_DIST;
    if (typeof functionsDist !== "string" || functionsDist.length === 0) {
      throw new Error(
        "Netlify did not provide the functions output directory (FUNCTIONS_DIST).",
      );
    }

    const assets = verifyFunctionArchive(process.cwd(), functionsDist);
    console.log(
      `Verified packaged knowledge assets: ${assets.join(", ")}`,
    );
  },
};
