require("dotenv").config();
const { UnicommerceClient, SoapFault } = require("../src/soapClient");

(async () => {
  const client = new UnicommerceClient({
    tenantUrl: process.env.UNICOMMERCE_TENANT_URL,
    username: process.env.UNICOMMERCE_USERNAME,
    apiKey: process.env.UNICOMMERCE_API_KEY,
  });
  try {
    const body = await client.call("<ser:SearchSaleOrderRequest/>");
    console.log("SUCCESS BODY:", JSON.stringify(body, null, 2));
  } catch (e) {
    if (e instanceof SoapFault) {
      console.log("SOAP FAULT (expected if auth passes but body invalid):", e.message);
    } else {
      console.error("UNEXPECTED ERROR:", e);
    }
  }
})();
