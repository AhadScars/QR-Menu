import QRCode from 'qrcode';
import PDFDocument from 'pdfkit';

export function qrPng(url) {
  return QRCode.toBuffer(url, {
    type: 'png',
    width: 1024,
    margin: 2,
    errorCorrectionLevel: 'H',
    color: { dark: '#000000', light: '#ffffff' },
  });
}

export function qrPdf({ name, url, png }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width;
    doc.fillColor('#000000').fontSize(13).text('SCANORA', 56, 72, { align: 'center', width: pageWidth - 112 });
    doc.fontSize(28).text(name, 56, 98, { align: 'center', width: pageWidth - 112 });
    doc.fillColor('#333333').fontSize(12).text('Scan to open the digital menu', 56, 142, {
      align: 'center',
      width: pageWidth - 112,
    });

    const size = 320;
    const imageX = (pageWidth - size) / 2;
    doc.image(png, imageX, 190, { width: size, height: size });
    doc.rect(imageX - 12, 178, size + 24, size + 24).lineWidth(1).strokeColor('#E5E5E5').stroke();

    doc.fillColor('#333333').fontSize(11).text(url, 72, 540, { align: 'center', width: pageWidth - 144 });
    doc.fillColor('#666666').fontSize(10).text('Menu updates automatically. This code does not need to be reprinted.', 72, 570, {
      align: 'center',
      width: pageWidth - 144,
    });
    doc.fillColor('#888888').fontSize(10).text('Powered by DigiHub Solutions', 72, 600, {
      align: 'center',
      width: pageWidth - 144,
    });
    doc.end();
  });
}
