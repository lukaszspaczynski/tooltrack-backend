# Certificates

`home-pl-dv-tls-g2-r35-ca.pem` is the intermediate CA that signs nac.com.pl,
downloaded from the address the site's own certificate names for it:
<http://homepldvtlsg2r35ca.repository.certum.pl/homepldvtlsg2r35ca.cer>.

    subject  C=PL, O=home.pl S.A., CN=home pl DV TLS G2 R35 CA
    issuer   C=PL, O=Asseco Data Systems S.A., OU=Certum Certification Authority,
             CN=Certum Trusted Root CA
    valid    2025-05-28 … 2035-05-16
    sha256   CA:1A:6E:0B:C3:B1:C2:ED:09:9D:42:D7:03:05:77:57:
             8D:13:F6:3B:4B:96:80:A6:BA:A2:74:DF:17:C9:DE:58

It is here because **nac.com.pl serves an incomplete chain**: the handshake
carries the leaf and nothing else, so a client is left holding a certificate
whose issuer it has never heard of. A browser recovers by fetching the missing
link from the address above — the AIA extension exists for exactly this — and
so does curl. Node does not chase AIA, and never has, so `fetch` fails the
handshake with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` and an import from that source
reports only that the page could not be fetched.

`NODE_EXTRA_CA_CERTS` in the `start` and `dev` scripts hands Node the missing
link. It has to be process-wide rather than something the importer passes with
its own request: the page is one fetch, and the photographs and the PDFs beside
it are a dozen more, all to the same misconfigured host.

This is not a new trust anchor. `Certum Trusted Root CA`, which signs this
intermediate, is already in Node's bundled root store — everything this file
changes is reachable today from any server that sends its chain in full.

Replace it when nac.com.pl moves to a different CA, or in 2035. The check is
`openssl s_client -connect nac.com.pl:443 -servername nac.com.pl`: a chain
printed with a single entry in it is still this problem.
