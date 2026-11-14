# Converts the Kelly project's Russian list (src/ru_m3.xls) to kelly.json: [lemma, CEFR, POS, freq, ipm] rows.
# Needs xlrd 2.x:  python3 -m pip install xlrd==2.0.1
import json, os, xlrd
S = os.path.dirname(os.path.abspath(__file__))
sheet = xlrd.open_workbook(os.path.join(S, "src", "ru_m3.xls")).sheet_by_index(0)
rows = [[sheet.cell_value(r, c) for c in range(5)] for r in range(1, sheet.nrows)]
json.dump(rows, open(os.path.join(S, "kelly.json"), "w"), ensure_ascii=False)
print(len(rows), "rows")
