const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require('path'); 
require("dotenv").config();
const fs = require("fs");
const recoveryService = require("./passwordRecoveryService");
const bookRoutes = require("./routes/bookRoutes"); // 👈 Se importará y se usará después

const app = express();
const PORT = process.env.PORT || 5000;
const SECRET_KEY = process.env.JWT_SECRET || "CLAVE_SECRETA_POR_DEFECTO";


// --- Configuración de Conexión a MySQL ---
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
};

// --- Middlewares globales ---
app.use(cors());
app.use(bodyParser.json());

// --- Crear carpeta de subida si no existe ---
const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log(`✅ Directorio de carga '${uploadDir}' creado.`);
}

// Carpeta uploads accesible públicamente
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ==========================================================
// 🔐 RUTAS DE AUTENTICACIÓN
// ==========================================================
const authRouter = express.Router();

// Parámetros para bloqueo temporal
const COOLDOWN_TIME_MS = 5 * 60 * 1000; // 30 minutos
const MAX_FAILED_ATTEMPTS = 3;

let dbPool; // 👈 se definirá más abajo, luego se pasa a bookRoutes

// ==========================================================
// 🚀 ENDPOINT: LOGIN
// ==========================================================
authRouter.post("/login", async (req, res) => {
    const { matricula, password } = req.body;

    try {
        const [rows] = await dbPool.query(
            "SELECT id_usuario, matricula, correo, contraseña, rol, intentos_fallidos, tiempo_bloqueo FROM usuarios WHERE matricula = ?",
            [matricula]
        );
        const user = rows[0];

        if (!user) {
            return res.status(401).json({ message: "Credenciales inválidas." });
        }

        // Verificar bloqueo temporal
        if (user.tiempo_bloqueo && new Date(user.tiempo_bloqueo) > new Date()) {
            const remainingTime = Math.ceil(
                (new Date(user.tiempo_bloqueo).getTime() - new Date().getTime()) / 1000
            );
            return res.status(403).json({
                message: `Su cuenta ha sido bloqueada temporalmente. Intente de nuevo en ${remainingTime} segundos.`,
            });
        }

        // Verificar contraseña
        const isMatch = await bcrypt.compare(password, user.contraseña);
        if (!isMatch) {
            const newAttempts = user.intentos_fallidos + 1;
            let bloqueoTime = null;
            let message = "Credenciales inválidas.";

            if (newAttempts >= MAX_FAILED_ATTEMPTS) {
                bloqueoTime = new Date(Date.now() + COOLDOWN_TIME_MS);
                const remainingTime = Math.ceil(COOLDOWN_TIME_MS / 1000);
                message = `Cuenta bloqueada temporalmente por ${MAX_FAILED_ATTEMPTS} intentos fallidos. Intente de nuevo en ${remainingTime} segundos.`;
            }

            await dbPool.query(
                "UPDATE usuarios SET intentos_fallidos = ?, tiempo_bloqueo = ? WHERE id_usuario = ?",
                [newAttempts, bloqueoTime, user.id_usuario]
            );

            return res.status(401).json({ message });
        }

        // Login exitoso → resetear intentos fallidos
        await dbPool.query(
            "UPDATE usuarios SET intentos_fallidos = 0, tiempo_bloqueo = NULL WHERE id_usuario = ?",
            [user.id_usuario]
        );

        // Crear token con el rol incluido
        const token = jwt.sign(
            { userId: user.id_usuario, rol: user.rol },
            SECRET_KEY,
            { expiresIn: "1h" }
        );

        res.status(200).json({ token, rol: user.rol });
    } catch (error) {
        console.error("Error en login:", error);
        res.status(500).json({ message: "Error interno del servidor." });
    }
});

// ==========================================================
// 🧑‍🎓 ENDPOINT: REGISTRO
// ==========================================================
authRouter.post("/register", async (req, res) => {
    const { matricula, correo, password } = req.body;

    if (!matricula || !correo || !password) {
        return res.status(400).json({ message: "Todos los campos son requeridos." });
    }

    try {
        const [existing] = await dbPool.query(
            "SELECT matricula FROM usuarios WHERE matricula = ?",
            [matricula]
        );

        if (existing.length > 0) {
            return res.status(409).json({ message: "La matrícula ya está registrada." });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const defaultRole = "Estudiante";

        await dbPool.query(
            "INSERT INTO usuarios (matricula, correo, contraseña, rol, intentos_fallidos) VALUES (?, ?, ?, ?, 0)",
            [matricula, correo, hashedPassword, defaultRole]
        );

        res.status(201).json({ message: "Registro exitoso. Ya puede iniciar sesión." });
    } catch (error) {
        console.error("Error en registro:", error);
        res.status(500).json({ message: "Error interno del servidor." });
    }
});

// ==========================================================
// 🔑 ENDPOINT: RECUPERAR CONTRASEÑA
// ==========================================================
authRouter.post("/forgot-password", async (req, res) => {
    const { recoveryInput } = req.body;

    try {
        if (!recoveryInput) {
            return res.status(400).json({ message: "Debe proporcionar correo o matrícula." });
        }

        const [users] = await dbPool.query(
            "SELECT id_usuario, correo FROM usuarios WHERE correo = ? OR matricula = ?",
            [recoveryInput, recoveryInput]
        );

        if (users.length === 0) {
            return res.status(200).json({
                message: "Si su cuenta existe, hemos enviado un correo con la contraseña temporal.",
            });
        }

        const tempPassword = recoveryService.generateTemporaryPassword();
        const userEmail = users[0].correo;

        await recoveryService.saveTemporaryPassword(dbPool, userEmail, tempPassword);
        const sent = await recoveryService.sendRecoveryEmail(userEmail, tempPassword);

        if (!sent) {
            return res.status(500).json({
                message: "No se pudo enviar el correo de recuperación. Revise la configuración SMTP.",
            });
        }

        res.status(200).json({
            message: "Contraseña temporal generada y enviada correctamente al correo (válida por 10 minutos).",
        });
    } catch (error) {
        console.error("Error en recuperación de contraseña:", error);
        res.status(500).json({ message: "Error interno del servidor." });
    }
});

// --- Conectar rutas de autenticación ---
app.use("/api/auth", authRouter);

// ==========================================================
// 🚀 CONEXIÓN A MYSQL Y ARRANQUE DEL SERVIDOR
// ==========================================================
async function connectToDb() {
    try {
        dbPool = await mysql.createPool(dbConfig);
        console.log(`✅ Conexión a MySQL (${process.env.DB_NAME}) exitosa.`);

        // 👇 Ahora que dbPool existe, inicializamos las rutas de libros
        app.use("/api/books", bookRoutes(dbPool));

        // 🚀 Arrancar servidor solo cuando DB esté lista
        app.listen(PORT, () => {
            console.log(`\n✅ Backend corriendo en: http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error("❌ Error al conectar a la base de datos:", err.message);
        process.exit(1);
    }
}

connectToDb();