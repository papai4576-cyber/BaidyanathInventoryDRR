const crypto = require("crypto");
const { parseStringPromise } = require("xml2js");

const PASSWORD_TYPE =
  "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText";
const NONCE_ENCODING_TYPE =
  "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary";

function buildSecurityHeader(username, password) {
  const nonce = crypto.randomBytes(16).toString("base64");
  const created = new Date().toISOString().replace(/\.\d+Z$/, ".000Z");
  return `
    <wsse:Security soapenv:mustUnderstand="1" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
      <wsse:UsernameToken wsu:Id="UsernameToken-1">
        <wsse:Username>${username}</wsse:Username>
        <wsse:Password Type="${PASSWORD_TYPE}">${password}</wsse:Password>
        <wsse:Nonce EncodingType="${NONCE_ENCODING_TYPE}">${nonce}</wsse:Nonce>
        <wsu:Created>${created}</wsu:Created>
      </wsse:UsernameToken>
    </wsse:Security>`;
}

function buildEnvelope({ username, password, bodyXml }) {
  return `<soapenv:Envelope xmlns:ser="http://uniware.unicommerce.com/services/" xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Header>${buildSecurityHeader(username, password)}
  </soapenv:Header>
  <soapenv:Body>
    ${bodyXml}
  </soapenv:Body>
</soapenv:Envelope>`;
}

function textValue(node) {
  if (node && typeof node === "object" && "_" in node) return node._;
  return node;
}

class SoapFault extends Error {
  constructor(faultstring, raw) {
    super(`SOAP fault: ${textValue(faultstring)}`);
    this.name = "SoapFault";
    this.raw = raw;
  }
}

class UnicommerceClient {
  constructor({ tenantUrl, username, apiKey, version = "1.9" }) {
    this.tenantUrl = tenantUrl.replace(/\/$/, "");
    this.username = username;
    this.apiKey = apiKey;
    this.endpoint = `${this.tenantUrl}/services/soap/?version=${version}`;
  }

  async call(bodyXml) {
    const envelope = buildEnvelope({
      username: this.username,
      password: this.apiKey,
      bodyXml,
    });

    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: '""',
      },
      body: envelope,
    });

    const text = await res.text();
    const parsed = await parseStringPromise(text, {
      explicitArray: false,
      tagNameProcessors: [(name) => name.replace(/^.*:/, "")],
    });

    const body = parsed?.Envelope?.Body;
    if (body?.Fault) {
      throw new SoapFault(body.Fault.faultstring, text);
    }
    return body;
  }
}

module.exports = { UnicommerceClient, SoapFault };
