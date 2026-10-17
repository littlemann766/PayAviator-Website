#!/usr/bin/env python3
"""Generates the sample spreadsheets used by import_test.mjs / import_ui_test.py. Needs openpyxl (+ optional soffice for .xls)."""
import openpyxl, datetime, os, zipfile, random, subprocess, shutil, sys
from openpyxl.utils import get_column_letter
out = os.path.dirname(os.path.abspath(__file__)); os.chdir(out)
D = datetime.date
def wb_save(wb, name): wb.save(name)

# 1. typical bill tracker: real Excel dates, currency formats, frequency + paid columns, a total row and a heading row
wb = openpyxl.Workbook(); ws = wb.active; ws.title = 'Bills'
ws.append(['My monthly bills']); ws.append([])
ws.append(['Bill', 'Amount', 'Due Date', 'Frequency', 'Category', 'Paid?', 'Notes'])
rows = [('Electric', 112.45, D(2026, 11, 3), 'Monthly', 'Utilities', 'No', 'Duke Energy'), ('Rent', 1450, D(2026, 11, 1), 'monthly', 'Housing', 'Yes', ''),
        ('Netflix', 15.49, D(2026, 11, 12), 'Monthly', 'Subscriptions', '', ''), ('Car insurance', 98.2, D(2026, 11, 20), 'Every 2 weeks', 'Insurance', 'x', ''),
        ('Gym', 24.99, D(2026, 11, 15), 'Yearly', 'Subscriptions', 'no', ''), ('Paycheck', 1850, D(2026, 11, 6), 'Biweekly', '', '', ''),
        ('Utilities', None, None, None, None, None, None), ('Total', 1800.12, None, None, None, None, None)]
for r in rows: ws.append(list(r))
for r in range(4, 12): ws.cell(r, 2).number_format = '"$"#,##0.00'; ws.cell(r, 3).number_format = 'mmm d, yyyy'
wb_save(wb, 'bills_typical.xlsx')

# 2. no header row, text dates, mixed amount styles
wb = openpyxl.Workbook(); ws = wb.active
for r in [('Water', '$45.10', '11/5/2026'), ('Phone', '85', '11/18/26'), ('Spotify', '9.99', 'Nov 9, 2026'), ('Student loan', '(210.00)', '2026-11-25'), ('Internet', '1,059.50', '3 Dec 2026')]: ws.append(r)
wb_save(wb, 'no_header.xlsx')

# 3. day-of-month only column, header names unusual
wb = openpyxl.Workbook(); ws = wb.active
ws.append(['Payee', 'Monthly payment', 'Day due']);
for r in [('Mortgage', 1900, 1), ('Electric', 130, '15th'), ('Water', 55.5, 28), ('Phone', 70, 31)]: ws.append(r)
wb_save(wb, 'day_only.xlsx')

# 4. multiple sheets: first hidden, second has data, third has data too
wb = openpyxl.Workbook(); a = wb.active; a.title = 'Notes'; a.append(['Name', 'Amount', 'Due']); a.append(['Hidden thing', 1, D(2026, 11, 1)]); a.sheet_state = 'hidden'
b = wb.create_sheet('November'); b.append(['Name', 'Amount', 'Due']); b.append(['Cable', 79.99, D(2026, 11, 10)]); b.append(['Trash', 22, D(2026, 11, 14)])
c = wb.create_sheet('December'); c.append(['Name', 'Amount', 'Due']); c.append(['Cable', 79.99, D(2026, 12, 10)])
wb_save(wb, 'multi_sheet.xlsx')

# 5. ambiguous: two money columns and no usable header -> must ask for column mapping
wb = openpyxl.Workbook(); ws = wb.active; ws.append(['Col A', 'Col B', 'Col C', 'Col D'])
for r in [('Phone', 85.0, 85.0, 'soon'), ('Gas', 40.5, 38.2, 'later')]: ws.append(r)
wb_save(wb, 'ambiguous.xlsx')

# 6. weird dates/amounts/names
wb = openpyxl.Workbook(); ws = wb.active; ws.append(['Name', 'Amount', 'Due date'])
for r in [('Good', 10, D(2026, 11, 2)), ('Bad date', 20, '13/45/2026'), ('Zero amount', 0, D(2026, 11, 2)), ('No amount', '', D(2026, 11, 2)), ('Text amount', 'about fifty', D(2026, 11, 2)),
          ('', 12, D(2026, 11, 2)), ('Huge', 5e12, D(2026, 11, 2)), ('Negative', -45.5, D(2026, 11, 2)), ('Euro style', '12,50', '2/3/2026'), ('Emoji 🏠 rent', 300, D(2026, 11, 2)),
          ('x' * 200, 5, D(2026, 11, 2)), ('<b>html</b> & "quotes"', 7, D(2026, 11, 2)), ('=1+1', 3, D(2026, 11, 2)), ('Leap', 9, '2/29/2028'), ('Not leap', 9, '2/29/2027')]: ws.append(r)
wb_save(wb, 'weird.xlsx')

# 7. 1904 date system
wb = openpyxl.Workbook(); wb.epoch = openpyxl.utils.datetime.CALENDAR_MAC_1904; ws = wb.active; ws.append(['Name', 'Amount', 'Due'])
ws.append(['Mac Excel bill', 33.33, D(2026, 12, 5)]); wb_save(wb, 'mac1904.xlsx')

# 8. huge: 6000 rows
wb = openpyxl.Workbook(); ws = wb.active; ws.append(['Name', 'Amount', 'Due'])
for i in range(6000): ws.append([f'Bill {i}', round(random.Random(i).uniform(5, 500), 2), D(2026, 11, 1) + datetime.timedelta(days=i % 28)])
wb_save(wb, 'huge_6000_rows.xlsx')

# 9. duplicates vs the demo data + inside the file
wb = openpyxl.Workbook(); ws = wb.active; ws.append(['Bill', 'Amount', 'Due'])
for r in [('Electric Bill', 120, D(2026, 11, 3)), ('Brand New Thing', 44, D(2026, 11, 8)), ('Brand New Thing', 44, D(2026, 11, 9)), ('Rent', 1500, D(2026, 11, 1))]: ws.append(r)
wb_save(wb, 'duplicates.xlsx')

# csv variants
open('plain.csv', 'w').write('Bill,Amount,Due Date,Frequency\nElectric,112.45,11/03/2026,Monthly\n"Smith, John (rent)","$1,200.00",2026-11-01,monthly\nGym,24.99,"Nov 15, 2026",\n')
open('semicolon_decimal_comma.csv', 'w').write('Name;Betrag;Faellig\nStrom;112,45;03.11.2026\nMiete;1200,00;01.11.2026\n')
open('bom_crlf_multiline.csv', 'wb').write(b'\xef\xbb\xbfName,Amount,Due,Notes\r\nInternet,60,11/10/2026,"line one\r\nline two"\r\nPhone,45.5,11/11/2026,\r\n')
open('latin1.csv', 'wb').write('Name,Amount,Due\nCaf\u00e9 loan,50,11/09/2026\n'.encode('cp1252'))
open('tab_separated.csv', 'w').write('Name\tAmount\tDue\nCable\t80\t11/12/2026\n')
open('empty.csv', 'w').write('')
open('only_header.csv', 'w').write('Name,Amount,Due\n')
open('garbage.csv', 'wb').write(os.urandom(4000))
open('notaspreadsheet.xlsx', 'w').write('this is not really an xlsx file')
# truncated + corrupted xlsx
data = open('bills_typical.xlsx', 'rb').read(); open('truncated.xlsx', 'wb').write(data[:len(data) // 2])
bad = bytearray(data); off = [i.header_offset for i in zipfile.ZipFile('bills_typical.xlsx').infolist() if i.filename == 'xl/worksheets/sheet1.xml'][0] + 80
for i in range(off, off + 25): bad[i] ^= 0xFF
open('corrupt.xlsx', 'wb').write(bytes(bad))
# zip bomb style: tiny zip, enormous sheet
with zipfile.ZipFile('bomb.xlsx', 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('xl/workbook.xml', '<workbook><sheets><sheet name="s" sheetId="1" r:id="rId1"/></sheets></workbook>')
    z.writestr('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
    z.writestr('xl/worksheets/sheet1.xml', '<worksheet><sheetData>' + ('<row><c r="A1"><v>1</v></c></row>' * 3_600_000) + '</sheetData></worksheet>')
# hand-made workbook: inline strings, stored (no compression), no styles/sharedStrings parts
with zipfile.ZipFile('inline_stored.xlsx', 'w', zipfile.ZIP_STORED) as z:
    z.writestr('xl/workbook.xml', '<workbook xmlns:r="x"><sheets><sheet name="s" sheetId="1" r:id="rId1"/></sheets></workbook>')
    z.writestr('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="/xl/worksheets/sheet1.xml"/></Relationships>')
    z.writestr('xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1" t="inlineStr"><is><t>Amount</t></is></c><c r="C1" t="inlineStr"><is><t>Due</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Tom &amp; Jerry &#x1F600; insurance</t></is></c><c r="B2"><v>77.5</v></c><c r="C2" t="inlineStr"><is><t>11/14/2026</t></is></c></row></sheetData></worksheet>')
# real LibreOffice-written files (xlsx + old xls)
if shutil.which('soffice'):
    os.makedirs('_lo', exist_ok=True)
    subprocess.run(['soffice', '--headless', '--convert-to', 'xls', '--outdir', '_lo', 'bills_typical.xlsx'], capture_output=True, timeout=120)
    subprocess.run(['soffice', '--headless', '--convert-to', 'ods', '--outdir', '_lo', 'bills_typical.xlsx'], capture_output=True, timeout=120)
    if os.path.exists('_lo/bills_typical.xls'): shutil.move('_lo/bills_typical.xls', 'old_format.xls')
    if os.path.exists('_lo/bills_typical.ods'): shutil.move('_lo/bills_typical.ods', 'opendoc.ods')
    # an xlsx re-saved by LibreOffice (different writer than openpyxl)
    subprocess.run(['soffice', '--headless', '--convert-to', 'xlsx', '--outdir', '_lo', 'multi_sheet.xlsx'], capture_output=True, timeout=120)
    if os.path.exists('_lo/multi_sheet.xlsx'): shutil.move('_lo/multi_sheet.xlsx', 'libreoffice_saved.xlsx')
    shutil.rmtree('_lo', ignore_errors=True)
print(sorted(os.listdir('.')))
