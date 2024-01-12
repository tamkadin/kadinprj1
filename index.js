const express = require('express');
const multer = require('multer');
const path = require('path');
const ejs = require('ejs');
const fs = require('fs');
const csv = require('csv-parser');
const xlsx = require('xlsx');
const { connect } = require('http2');
const conn = require('./connect');

const app = express();
const port = process.env.PORT || 3000;

// Hàm xử lý upload file Excel
const readAndProcessExcel = async (filePath, classID, classname) => {
    try {
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(sheet);
        const userType = 2;
        const dataArray = Object.values(data);
    
        for (const row of dataArray) {
            const { 'Họ và tên': FullName, 'MSSV': Username, 'Điểm giữa kỳ': midtermScore, 'Điểm cuối kỳ': finalScore } = row;
            const sUsername = String(Username);
            const userPassword = sUsername.slice(-4);
            processData(userType, sUsername, userPassword, FullName, classname, classID, midtermScore, finalScore);
        }
    } catch (error) {
        throw error;
    }
};

// Hàm xử lý upload file CSV
const readAndProcessCSV = async (filePath, classID, classname) => {
    try {
        const data = [];

        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (row) => {
                const { 'Họ và tên': FullName, 'MSSV': Username, 'Điểm giữa kỳ': MidtermScore, 'Điểm cuối kỳ': FinalScore } = row;
                const sUsername = String(Username);
                const userPassword = sUsername.slice(-4);
                data.push(row);
                processData(2, sUsername, userPassword, FullName, classname, classID, MidtermScore, FinalScore);
            })
            .on('end', () => {
                console.log('CSV file successfully processed');
            });

        return data;
    } catch (error) {
        throw error;
    }
};

//Lưu dữ liệu vào data
const processData = async (userType, sUsername, userPassword, FullName, classname, classID, midtermScore, finalScore) => {
    try {
        // Tạo người dùng mới hoặc bỏ qua nếu đã tồn tại
        const checkUserQuery = 'SELECT * FROM Users WHERE Username = ?';
        conn.query(checkUserQuery, [sUsername], function (err, checkUserResult) {
            if (err) throw err;

            if (checkUserResult.length === 0) {
                // Nếu username chưa tồn tại, thực hiện insert
                const insertUserQuery = 'INSERT INTO Users (Username, Password, UserType) VALUES (?, ?, ?)';
                conn.query(insertUserQuery, [sUsername, userPassword, userType]);
            }

            // Lấy hoặc tạo sinh viên mới và liên kết với người dùng
            const getUserQuery = 'SELECT * FROM Users WHERE Username = ?';
            conn.query(getUserQuery, [sUsername], function (err, userResults) {
                if (err) throw err;

                const userID = userResults[0].UserID;
                const checkStudentQuery = 'SELECT * FROM Students WHERE UserID = ?';
                conn.query(checkStudentQuery, [userID], function (err, checkstudentResult) {
                    if (err) throw err;

                    if (checkstudentResult.length === 0) {
                        const insertStudentQuery = 'INSERT INTO Students (UserID, FullName) VALUES (?, ?)';
                        conn.query(insertStudentQuery, [userID, FullName]);
                    }

                    // Thêm lớp học mới hoặc bỏ qua nếu đã tồn tại
                    const checkClassQuery = 'SELECT * FROM Classes WHERE ClassID = ?';
                    conn.query(checkClassQuery, [classID], function (err, checkclassResult) {
                        if (err) throw err;

                        if (checkclassResult.length === 0) {
                            const insertClassQuery = 'INSERT INTO Classes (ClassID, ClassName) VALUES (?, ?)';
                            conn.query(insertClassQuery, [classID, classname]);
                        }
                        // Thêm điểm cho sinh viên và lớp học
                        const getStudentIDQuery = 'SELECT * FROM Students WHERE UserID = ?';
                        conn.query(getStudentIDQuery, [userID], function (err, studentResults) {
                            if (err) throw err;

                            const StudentID = studentResults[0].StudentID;
                            const checkScoreQuery = 'SELECT * FROM Scores WHERE ClassID = ? AND StudentID = ?';
                            conn.query(checkScoreQuery, [classID, StudentID], function (err, checkscoreResult) {
                                if (err) throw err;
                                if (checkscoreResult.length === 0) {
                                    const insertScoreQuery = 'INSERT INTO Scores (StudentID, ClassID, MidtermScore, FinalScore) VALUES (?, ?, ?, ?)';
                                    conn.query(insertScoreQuery, [StudentID, classID, midtermScore, finalScore]);
                                } else {
                                    const updateScoreQuery = `
                                        UPDATE Scores
                                        SET MidtermScore = ?, FinalScore = ?
                                        WHERE StudentID = ? AND ClassID = ?;
                                    `;
                                    conn.query(updateScoreQuery, [StudentID, classID, midtermScore, finalScore]);
                                }
                                const insertNotiQuery = 'INSERT INTO thongbao ( UserID, ClassID, date) VALUES (?, ?, NOW())';
                                conn.query(insertNotiQuery, [ userID, classID]);
                            });
                        });
                    });
                });
            });
        });
    } catch (error) {
        console.error(error);
        throw error;
    }
};

const storage = multer.diskStorage({
    destination: './public/uploads/',
    filename: function (req, file, cb) {
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
    },
});

const upload = multer({
    storage: storage,
}).single('gradesFile');

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// Xử lý trang đăng nhập
app.get('/', async function(req, res) {
    res.render('index');
});
app.post('/login', async (req, res) => {
    try {
        const username = req.body.username;
        const password = req.body.password;
        
        conn.query("SELECT * FROM users WHERE Username = ? AND Password = ?", [username, password], function(err, data) {
            if (data.length === 0) {
                res.render('index', { errorMessage: 'Tên đăng nhập hoặc mật khẩu không đúng.' });
                return;
            }

            const user = data[0];

            if (user.UserType === 1) {
                conn.query("SELECT FullName FROM teachers WHERE UserID = ?", [user.UserID], function(err, adminData) {
                    const admin = adminData[0];
                    const fullName = admin ? admin.FullName : 'Tên người dùng mẫu';
                    res.redirect(`/teacher?fullName=${encodeURIComponent(fullName)}&userID=${user.UserID}`);
                });
            } else if (user.UserType === 2) {
                conn.query("SELECT FullName FROM students WHERE UserID = ?", [user.UserID], function(err, studentData) {
                    const student = studentData[0];
                    const fullName = student ? student.FullName : 'Tên người dùng mẫu';
                    res.redirect(`/student?fullName=${encodeURIComponent(fullName)}&userID=${user.UserID}`);
                });
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Có lỗi xử lý đăng nhập.');
    }
});

// Xử lý trang sinh viên
app.get('/student', async (req, res) => {
    try {
        const fullName = req.query.fullName;
        const userID = req.query.userID;
        conn.query("SELECT * FROM thongbao WHERE UserID = ?", [userID], function(err, NotiData) {
            res.render('homestudent', {
                username: fullName,
                userID: userID,
                NotiData: NotiData,
            });
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Có lỗi khi xử lý trang sinh viên.');
    }
});

// Xử lý trang giáo viên
app.get('/teacher', async (req, res) => {
    try {
        const userID = req.query.userID;
        const username = req.query.fullName;
        res.render('homeadmin', {
            username: username,
            userID: userID,
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Có lỗi khi xử lý trang giáo viên.');
    }
});

// Xử lý hiển thị điểm
app.get('/student/result', async (req, res) => {
    try {
        const userID = req.query.userID;
        const username = req.query.username;
        const classID = req.query.classID;

        const query = `
        SELECT
        Users.Username,
        Students.FullName AS StudentName,
        Classes.ClassName,
        Scores.MidtermScore,
        Scores.FinalScore
        FROM
            Users
        JOIN Students ON Users.UserID = Students.UserID
        JOIN Scores ON Students.StudentID = Scores.StudentID
        JOIN Classes ON Scores.ClassID = Classes.ClassID
        WHERE
            Users.UserID = ?
            AND Classes.ClassID = ?;
        `;
        conn.query(query, [userID, classID], function(err, result) {
            if (err) {
                console.error(err);
                return res.status(500).send('Có lỗi khi truy vấn dữ liệu điểm.');
            }
            if (result && result.length > 0) {
                const data = result[0];
                conn.query("SELECT * FROM thongbao WHERE UserID = ?", [userID], function(err, NotiData) {
                    res.render('student_result', {
                        username: username,
                        mssv: data.Username,
                        userID: userID,
                        classID: classID,
                        className: data.ClassName,
                        midtermScore: data.MidtermScore,
                        finalScore: data.FinalScore,
                        NotiData: NotiData,
                    });
                });
            } else {
                conn.query("SELECT * FROM thongbao WHERE UserID = ?", [userID], function(err, NotiData) {
                    res.render('homestudent', {
                        username: username,
                        userID: userID,
                        NotiData: NotiData,
                        errorMessage: 'Mã lớp chưa đúng hoặc chưa có điểm cho lớp này !',
                    });
                return;
            });
        }
    });
    } catch (error) {
        console.error(error);
        res.status(500).send('Có lỗi khi xử lý hiển thị điểm');
    }
});

// Xử lý trang upload điểm
app.post('/teacher/upload', async (req, res) => {
    try {
        const userID = req.body.userID;
        const username = req.body.username;

        upload(req, res, async (err) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Có lỗi khi tải lên file.');
            }
            try {
                const filePath = req.file.path;
                const fileType = path.extname(req.file.originalname).toLowerCase();
                const classID = req.body.classID;
                const classname = req.body.classname;

                let data;

                if (fileType === '.xlsx') {
                    data = await readAndProcessExcel(filePath, classID, classname);
                } else if (fileType === '.csv') {
                    data = await readAndProcessCSV(filePath, classID, classname);
                } else {
                    res.render('homeadmin', { errorMessage1: 'Định dạng file không hỗ trợ !',username: username,userID: userID, });
                    return;
                }
                res.render('homeadmin', { 
                    errorMessage: 'Đã upload file thành công',
                    username: username,
                    userID: userID,
                });
                return;
            } catch (error) {
                console.error(error);
                res.status(500).send('Có lỗi xử lý file hoặc lưu dữ liệu.');

            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Có lỗi xử lý upload.');
    }
});

// Xử lý đăng xuất
app.get('/logout', (req, res) => {
    res.redirect('/');
});

// Khởi động server
app.listen(port);

