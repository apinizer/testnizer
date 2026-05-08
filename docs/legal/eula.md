# Testnizer — End-User License Agreement (EULA)

**Effective date:** 2026-05-07
**Last updated:** 2026-05-08
**Applies to:** Testnizer v1.0.3 and later

This End-User License Agreement ("Agreement") is a binding contract between
**you** ("Licensee", "you") and **Pruvasoft Bilişim Teknolojileri Yazılım Danışmanlık ve Eğitim A.Ş.** ("Licensor", "we",
"our"), located in **İstanbul, Republic of Türkiye**, concerning your use of
the **Testnizer** desktop application — the pre-built binary distribution
(DMG, EXE, AppImage, deb, zip, or any other packaged installer obtained from
our official channels) — and any accompanying documentation (collectively,
the "Software").

By installing, copying, downloading, or otherwise using the Software, you
acknowledge that you have read, understood, and agreed to be bound by this
Agreement. If you do not agree, do not install or use the Software.

---

## 1. Acceptance of Terms

This Agreement is presented to you on first launch of the Software through an
in-application consent gate. You must accept this Agreement and the
accompanying Privacy Policy to use the Software. The Software computes a
SHA-256 hash of this document; if the document changes in a future release,
the consent gate will re-prompt you to accept the updated text on the next
launch. If you decline the updated text, the Software will exit and you must
uninstall it to terminate the relationship.

---

## 2. Dual License Model

Testnizer is distributed under a **dual licensing model**:

- **Source code** — released under the **MIT License** (see the `LICENSE`
  file in the public source repository at
  `https://github.com/apinizer/testnizer`). The MIT License grants you the
  right to view, copy, modify, merge, publish, distribute, sublicense, and
  sell copies of the source code, subject to the conditions stated in that
  license. Nothing in this Agreement narrows the rights granted to you by
  the MIT License with respect to the source code.

- **Pre-built binary distribution** — the installers we publish on our
  official channels (Testnizer.com, GitHub Releases) are governed by **this
  Agreement**. This Agreement covers the binary artifacts, the auto-update
  channel, and any data-handling behavior of those binaries. If you build
  Testnizer yourself from source, the MIT License governs your build; this
  Agreement applies only when you choose to install the binaries we
  distribute.

In the event of any conflict between this Agreement and the MIT License with
respect to the **source code**, the MIT License controls. With respect to
the **binary distribution and its update channel**, this Agreement controls.

---

## 3. License Grant (Binary Use)

Subject to your compliance with this Agreement, the Licensor grants you a
worldwide, royalty-free, non-exclusive, perpetual (subject to Section 12)
license to:

(a) install and use the binary Software on any number of devices you own or
    control;
(b) use the Software for personal, educational, or commercial purposes,
    including within a for-profit organization;
(c) make backup copies of the installer for archival purposes.

This license is granted for the binary form only. Your rights with respect
to the source code are governed by the MIT License and are not narrowed by
this Section.

---

## 4. Permitted Use

You may use the Software to:

- test, develop, debug, and document APIs and network services that you are
  authorized to access;
- store API definitions, requests, environments, certificates, and
  credentials locally on your device;
- import and export collections in standard interoperable formats (OpenAPI,
  Postman, Insomnia, cURL, HAR, WSDL, Proto, and similar);
- run automated test suites and collection runners against authorized
  targets;
- redistribute, modify, and fork the **source code** under the terms of the
  MIT License.

The Software is a developer-side testing tool that requires **no Licensor
backend service** and **no Licensor account** to function. It may be
installed and operated entirely on a single device, including in fully
isolated, network-segmented, or air-gapped environments where the
auto-update channel and any optional telemetry are unreachable. In such
environments the Software remains fully usable subject to the version of
this Agreement to which you most recently consented.

---

## 5. Restrictions

You agree that you will not, in connection with the **binary distribution**
of the Software:

(a) reverse-engineer, decompile, or disassemble the published binary
    artifacts in an attempt to circumvent licensing or update mechanisms;
    inspection of the source code through the public repository is expressly
    permitted under the MIT License and is not a violation of this clause;
(b) use the Software to access, scan, probe, or attack any system, network,
    or service for which you do not have explicit, demonstrable
    authorization (including penetration testing without written consent);
(c) use the Software in safety-critical or life-support environments,
    including but not limited to medical devices, nuclear facilities,
    aircraft navigation or control, weapons systems, or any environment in
    which a failure of the Software could result in death, personal injury,
    or severe environmental or property damage;
(d) repackage, rebrand, or redistribute the **binary distribution** as a
    directly competing product. The MIT License permits forking, modifying,
    and redistributing the source code; this restriction targets only the
    repackaging of our official binaries, the appropriation of the
    "Testnizer" brand identity, or the substitution of our update channel;
(e) use the Software to violate any applicable law or regulation, including
    data-protection laws (GDPR, KVKK, CCPA, etc.), export-control laws, the
    Computer Fraud and Abuse Act and analogous statutes, or to commit
    fraud or theft;
(f) remove, alter, or obscure any copyright, trademark, license, or
    attribution notice embedded in the binary, the application's "About"
    screen, the auto-update payload, or the bundled documentation.

---

## 6. Auto-Update Consent

The Software includes an auto-update mechanism (`electron-updater`) that
periodically checks the public GitHub Releases feed at
`https://github.com/apinizer/testnizer/releases` for newer versions. By
using the Software with auto-update enabled (the default), you consent to:

(a) periodic outbound HTTPS requests to GitHub solely to check for and
    download new versions of the Software;
(b) the Software replacing itself with a newer version, with your
    confirmation where the operating system requires it.

The information transmitted in these requests is limited to the standard
HTTP request metadata (your IP address as visible to GitHub, the updater
User-Agent containing the application name and current version) and contains
no data about your workspaces, requests, or usage. See the Privacy Policy
for full details.

You may disable auto-update at any time in **Settings → Updates**. The
Licensor reserves the right to modify, suspend, or discontinue the auto-update
service at any time without notice. The locally installed copy of the
Software remains usable indefinitely irrespective of update-channel
availability.

---

## 7. Open-Source Components

The Software is built on open-source libraries and frameworks, including but
not limited to: Electron, Node.js, React, TypeScript, Tailwind CSS, Monaco
Editor, Zustand, better-sqlite3, axios, ws, soap, graphql, @grpc/grpc-js, and
many others. Each component is governed by its own upstream license (MIT,
BSD, Apache 2.0, ISC, MPL 2.0, etc.). A complete list with attributions is
available in the Software at **About → Open-source licenses** and in the
public source repository. Nothing in this Agreement modifies the rights
granted to you by those upstream licenses.

---

## 8. Trademarks

"Testnizer" and the Testnizer logo are trademarks of Pruvasoft Bilişim Teknolojileri Yazılım Danışmanlık ve Eğitim A.Ş.
You may refer to the Software by its name in editorial, journalistic, or
educational contexts. You may not use Licensor's name, logo, or trademarks
to endorse, promote, or imply affiliation with any product or service
derived from the Software without prior written permission from the
Licensor.

The names "Postman", "SoapUI", "ReadyAPI", "Insomnia", "JetBrains",
"HTTPie", "OpenAPI", "Swagger", "Apple", "macOS", "Microsoft", "Windows",
"Linux", "GitHub", "OpenAI", "Anthropic", "Google", and any other
third-party trademarks referenced in the Software or this documentation are
the property of their respective owners. References to these names — for
example, when describing import/export formats or AI provider compatibility
— are made solely for interoperability and identification purposes and do
not imply endorsement, sponsorship, or affiliation with the respective
owners.

---

## 9. Disclaimer of Warranties

THE SOFTWARE IS PROVIDED **"AS IS"** AND **"AS AVAILABLE"**, WITHOUT
WARRANTY OF ANY KIND, EXPRESS, IMPLIED, OR STATUTORY, INCLUDING WITHOUT
LIMITATION THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
PURPOSE, TITLE, ACCURACY, AND NON-INFRINGEMENT.

THE LICENSOR DOES NOT WARRANT THAT THE SOFTWARE WILL BE UNINTERRUPTED,
ERROR-FREE, SECURE, OR FREE OF HARMFUL COMPONENTS, NOR THAT DEFECTS WILL BE
CORRECTED.

You acknowledge that the Software is a developer tool that issues network
requests on your behalf, parses arbitrary user-supplied input, and stores
secrets locally; that misuse — including sending requests to unauthorized
targets, mishandling production credentials, or running untrusted scripts —
may have legal, financial, regulatory, or operational consequences for which
you alone are responsible.

---

## 10. No Maintenance, No Patch Obligation

The Software is distributed free of charge and on a best-effort basis. The
Licensor has **no obligation** under this Agreement, under the MIT License
covering the source code, or under any related communication, to:

(a) provide technical support, maintenance, error correction, or any form
    of help-desk service;
(b) issue, prepare, develop, or release any update, upgrade, patch,
    hotfix, or new version, whether to add functionality, restore
    compatibility with third-party services or operating systems, or for
    any other reason;
(c) investigate, acknowledge, triage, or remediate any defect, bug, error,
    incompatibility, or **security vulnerability** — including critical
    vulnerabilities that may permit data disclosure, code execution,
    privilege escalation, denial of service, or any other adverse
    impact — whether disclosed publicly, reported privately to the
    Licensor, or affecting any open-source component embedded in the
    Software;
(d) honor any service-level objective, response time, severity rating, or
    remediation deadline, including those that may otherwise be customary
    in commercial software;
(e) maintain backward or forward compatibility with prior versions of the
    Software, with stored data files produced by prior versions, or with
    any third-party tool, file format, protocol, or service.

The Licensor may, **at its sole and unfettered discretion** and at any
time, choose to release fixes or new versions, or to abandon all further
development of the Software. You acknowledge that this is a free-of-charge
distribution and that any decision regarding maintenance is made entirely
on a voluntary basis. You waive any claim premised on an asserted
obligation to update, support, or remediate the Software.

If a security-relevant defect materially affects your use of the Software,
your **sole remedy** is to cease using the Software, uninstall it, and (if
desired) deploy a different tool. You may also exercise the rights granted
by the MIT License to fork the source code and apply your own corrections
at your own expense.

This Section is an essential basis of the bargain: in exchange for
receiving the Software at no charge and under a permissive source-code
license, you accept that no maintenance, support, or security-patch
commitment is being made.

---

## 11. Limitation of Liability

The Software is distributed free of charge. You have not paid any fee to
obtain the Software.

TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL THE
LICENSOR, ITS AFFILIATES, OFFICERS, DIRECTORS, EMPLOYEES, AGENTS, OR
CONTRIBUTORS BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL,
CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS,
REVENUE, BUSINESS, DATA, OR GOODWILL, ARISING OUT OF OR IN CONNECTION WITH
YOUR USE OF — OR INABILITY TO USE — THE SOFTWARE, REGARDLESS OF THE LEGAL
THEORY (CONTRACT, TORT, NEGLIGENCE, STRICT LIABILITY, OR OTHERWISE) AND
EVEN IF THE LICENSOR HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.

THE LICENSOR'S TOTAL CUMULATIVE LIABILITY UNDER OR IN CONNECTION WITH THIS
AGREEMENT SHALL NOT EXCEED THE AMOUNT YOU PAID TO OBTAIN THE SOFTWARE,
WHICH IS **ZERO**.

Some jurisdictions do not allow the exclusion or limitation of liability for
incidental or consequential damages, so portions of this Section may not
apply to you. Where mandatory consumer-protection law in your place of
residence provides a higher floor, that floor applies in place of the cap
above to the extent so required.

---

## 12. Indemnification

You agree to defend, indemnify, and hold harmless the Licensor, its
affiliates, officers, directors, employees, contractors, agents, and
contributors from and against any and all claims, damages, obligations,
losses, liabilities, costs, and expenses (including reasonable attorneys'
fees) arising out of or relating to:

(a) your use or misuse of the Software;
(b) your violation of this Agreement, including any breach of the
    restrictions in Section 5;
(c) your violation of any third-party right, including any intellectual
    property right, privacy right, or contractual right;
(d) the data, requests, credentials, or content you process through the
    Software, including any harm caused to systems you target.

The Licensor reserves the right, at its own expense, to assume the
exclusive defense and control of any matter otherwise subject to
indemnification by you, in which event you will cooperate with the Licensor
in asserting any available defenses.

---

## 13. Termination

This Agreement is effective until terminated. It will terminate automatically
without notice if you fail to comply with its terms. Upon termination you
must cease all use of the Software and destroy all copies in your possession
or control. You may terminate this Agreement at any time by uninstalling the
Software and deleting the user-data directory described in the Privacy
Policy.

Sections 5 (Restrictions), 8 (Trademarks), 9 (Disclaimer of Warranties),
10 (No Maintenance, No Patch Obligation), 11 (Limitation of Liability),
12 (Indemnification), 14 (Export Control), 15 (Governing Law),
17 (Severability / Entire Agreement), and 18 (Contact) survive termination.

---

## 14. Export Control

You agree to comply with all applicable export-control and trade-sanctions
laws and regulations, including those of the Republic of Türkiye, the
European Union, the United States (including the Export Administration
Regulations and OFAC sanctions programs), and the United Nations Security
Council. You represent and warrant that:

(a) you are not located in, under the control of, or a national or resident
    of any country or territory subject to a comprehensive embargo by those
    authorities;
(b) you are not listed on any restricted-party or sanctioned-party list
    maintained by those authorities;
(c) you will not export, re-export, transfer, or otherwise make the
    Software available to any prohibited destination, end-user, or
    end-use.

---

## 15. Governing Law and Jurisdiction

This Agreement is governed by the laws of the **Republic of Türkiye**,
without regard to its conflict-of-laws principles. Any dispute, controversy,
or claim arising out of or relating to this Agreement, or the breach,
termination, or invalidity thereof, shall be submitted to the exclusive
jurisdiction of the courts and execution offices of **Ankara, Türkiye**,
except where mandatory consumer-protection laws of your place of residence
provide otherwise.

The MIT License covering the source code is unaffected by this clause and
its enforceability under its own choice-of-law rules (where applicable) is
preserved.

---

## 16. Changes to this EULA

The Licensor may update this Agreement from time to time. Material changes
are reflected by updating the **Last updated** date at the top of this
document and incrementing the document hash. When the document hash
changes, the in-application consent gate will prompt you to review and
accept the updated text on the next launch of the Software. If you decline
the updated text, the Software will exit and you must uninstall it to
terminate the relationship.

The Licensor may modify, suspend, or discontinue the Software, the
auto-update service, or any feature thereof at any time without notice or
liability to you. Your locally installed copy remains usable subject to the
terms of the version of this Agreement to which you most recently consented.

---

## 17. Severability and Entire Agreement

- **Entire agreement.** This Agreement, the Privacy Policy, and (with
  respect to the source code) the MIT License together constitute the entire
  agreement between you and the Licensor regarding the Software, and
  supersede any prior or contemporaneous understandings, communications, or
  agreements.
- **Severability.** If any provision of this Agreement is held by a court
  of competent jurisdiction to be unenforceable, that provision shall be
  modified to the minimum extent necessary to make it enforceable, and the
  remaining provisions shall remain in full force and effect.
- **No waiver.** Failure or delay by the Licensor in enforcing any right
  under this Agreement shall not be a waiver of that right.
- **Assignment.** You may not assign this Agreement, in whole or in part,
  without the Licensor's prior written consent. The Licensor may assign
  this Agreement in connection with a merger, acquisition, reorganization,
  or sale of all or substantially all of its assets.

---

## 18. Contact

For questions about this Agreement, including legal, compliance, or
intellectual-property inquiries:

- **Legal & privacy:** info@apinizer.com
- **General support:** info@apinizer.com
- **Enterprise / commercial support, SLAs, on-premise deployment, training:** info@apinizer.com
- **Source repository:** https://github.com/apinizer/testnizer
- **Website:** https://www.testnizer.com
- **Postal:** Pruvasoft Bilişim Teknolojileri Yazılım Danışmanlık ve Eğitim A.Ş., İstanbul, Türkiye

The general distribution of the Software is, and will remain, free of charge.
Enterprise / commercial support is offered on a separate contractual basis
and is **not** a precondition of using the free binary distribution.

Copyright © 2026 Pruvasoft Bilişim Teknolojileri Yazılım Danışmanlık ve Eğitim A.Ş. All rights reserved with respect to
the binary distribution. Source code rights are governed by the MIT License.
