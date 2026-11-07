from pathlib import Path
import canvas_picture_fill_fixture as fixture
fixture.SOURCE=Path(__file__).resolve().parents[1]/'tests/fixtures/large-picture-rectangles/controls.docx'
fixture.CASES=[('Top -1500 percent',{}, {'t':'-1500000'},False),('Bottom -1500 percent',{}, {'b':'-1500000'},False),('Left -2000 percent',{}, {'l':'-2000000'},False),('Right -2000 percent',{}, {'r':'-2000000'},False),('Combined signed destination',{}, {'t':'25000','b':'-1500000','l':'-1200000','r':'15000'},False),('Source outset -1500 percent',{'l':'-1500000'},{},False),('Source percent spelling',{'t':'-1200.001%'},{},False),('Source and destination',{'l':'-1500000'},{'l':'-1500000'},False)]
fixture.generate()

