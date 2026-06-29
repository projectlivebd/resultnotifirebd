async function fetchResult(student) {
  const BOARD_MAP = {
    dhaka:'dhaka', rajshahi:'rajshahi', chittagong:'chittagong',
    comilla:'comilla', sylhet:'sylhet', jessore:'jessore',
    barisal:'barisal', dinajpur:'dinajpur', mymensingh:'mymensingh',
    madrasah:'madrasah', technical:'technical',
  };
  const EXAM_MAP = {
    'SSC':'ssc', 'Dakhil':'dakhil', 'HSC':'hsc',
    'Alim':'alim', 'JSC':'jsc', 'JDC':'jdc', 'Diploma':'ssc_voc',
  };

  const board   = BOARD_MAP[student.board]  || student.board;
  const exam    = EXAM_MAP[student.exam]    || student.exam.toLowerCase();

  try {
    const response = await axios.get(
      'https://eboardresults.com/app/stud/api/get_result',
      {
        params: {
          exam:  exam,
          year:  student.year,
          board: board,
          roll:  student.roll,
          reg:   student.reg,
          type:  'individual',
        },
        timeout: 20000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Accept': 'application/json',
          'Referer': 'https://eboardresults.com/v2/home',
        },
      }
    );

    logInfo(`API response for Roll ${student.roll}`, {
      status: response.status,
      data: JSON.stringify(response.data).slice(0, 200),
    });

    return { success: true, data: response.data };
  } catch(err) {
    if (err.response?.status === 404) return { success: true, data: null };
    return { success: false, error: err.message };
  }
}
