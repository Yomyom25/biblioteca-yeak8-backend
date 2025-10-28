const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const recoveryService = require("./passwordRecoveryService");

const app = express();
const PORT = process.env.PORT || 5000;
const SECRET_KEY = process.env.JWT_SECRET || "CLAVE_SECRETA_POR_DEFECTO";

// --- Configuración de Conexión a MySQL (usando .env) ---
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
};

let dbPool;

// --- Middlewares ---
app.use(cors());
app.use(bodyParser.json());

// Función para conectar y crear el Pool de Conexiones
async function connectToDb() {
    try {
        dbPool = await mysql.createPool(dbConfig);
        console.log(`✅ Conexión a MySQL (${process.env.DB_NAME}) exitosa.`);

        app.listen(PORT, () => {
            console.log(`\n✅ Backend corriendo en: http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error("❌ Error al conectar a la base de datos:", err.message);
        process.exit(1);
    }
}

// --- Router de Autenticación ---
const authRouter = express.Router();

// [POST] /api/auth/register
authRouter.post("/register", async (req, res) => {
    const { matricula, correo, password } = req.body;

    if (!matricula || !correo || !password) {
        return res
            .status(400)
            .json({ message: "Todos los campos son obligatorios." });
    }

    try {
        // 1. Verificar si el usuario ya existe
        const [existingUsers] = await dbPool.query(
            "SELECT id_usuario FROM usuarios WHERE matricula = ? OR correo = ?",
            [matricula, correo]
        );

        if (existingUsers.length > 0) {
            return res
                .status(409)
                .json({ message: "La matrícula o el correo ya están registrados." });
        }

        // 2. Hashear la contraseña
        const hashedPassword = await bcrypt.hash(password, 10);

        // 3. Insertar nuevo usuario
        const role = "Estudiante";
        const multa = "ninguna";

        const [result] = await dbPool.query(
            "INSERT INTO usuarios (matricula, correo, contraseña, rol, multa) VALUES (?, ?, ?, ?, ?)",
            [matricula, correo, hashedPassword, role, multa]
        );

        return res.status(201).json({
            message: "Registro exitoso. Puedes iniciar sesión.",
            userId: result.insertId,
        });
    } catch (error) {
        console.error("Error en el registro:", error);
        return res
            .status(500)
            .json({ message: "Error interno del servidor durante el registro." });
    }
});

// [POST] /api/auth/login
authRouter.post("/login", async (req, res) => {
    const { matricula, password } = req.body;
    const LIMITE_INTENTOS = 3;
    const COOLDOWN_MINUTOS = 5;
    const now = new Date();

    try {
        // 1. Buscar usuario por Matrícula O Correo
        const [users] = await dbPool.query(
            "SELECT * FROM usuarios WHERE matricula = ? OR correo = ?",
            [matricula, matricula]
        );

        if (users.length === 0) {
            return res
                .status(401)
                .json({ message: "Matrícula, correo o contraseña incorrectos." });
        }

        let user = users[0];

        // 2. CONTROL DE COOLDOWN DE 5 MINUTOS
        if (user.intentos_fallidos >= LIMITE_INTENTOS && user.tiempo_bloqueo) {
            const cooldownStartTime = new Date(user.tiempo_bloqueo);
            cooldownStartTime.setMinutes(
                cooldownStartTime.getMinutes() + COOLDOWN_MINUTOS
            );

            if (now < cooldownStartTime) {
                // Bloqueo ACTIVO
                const tiempoRestanteMs = cooldownStartTime.getTime() - now.getTime();
                const tiempoRestanteSeg = Math.ceil(tiempoRestanteMs / 1000);

                return res.status(403).json({
                    message: `Su cuenta ha sido bloqueada temporalmente. Intente de nuevo en ${tiempoRestanteSeg} segundos.`,
                });
            } else {
                // Cooldown expiró, reinicia intentos fallidos y tiempo_bloqueo
                await dbPool.query(
                    "UPDATE usuarios SET intentos_fallidos = 0, tiempo_bloqueo = NULL WHERE id_usuario = ?",
                    [user.id_usuario]
                );
                user.intentos_fallidos = 0;
                user.tiempo_bloqueo = null;
            }
        }

        // 3. Verificar Contraseña
        const passwordMatch = await bcrypt.compare(password, user.contraseña);

        if (passwordMatch) {
            // Verificar si es una contraseña temporal expirada
            if (user.expiracion_temp_pass) {
                const tempPassExpires = new Date(user.expiracion_temp_pass);
                if (now > tempPassExpires) {
                    // La contraseña temporal expiró - BLOQUEAR LOGIN
                    await dbPool.query(
                        "UPDATE usuarios SET expiracion_temp_pass = NULL WHERE id_usuario = ?",
                        [user.id_usuario]
                    );
                    return res.status(401).json({
                        message:
                            "La contraseña temporal ha expirado. Solicita una nueva recuperación.",
                    });
                }
            }

            // LOGIN EXITOSO
            // Limpiar TODAS las variables de seguridad
            if (
                user.intentos_fallidos > 0 ||
                user.tiempo_bloqueo ||
                user.expiracion_temp_pass
            ) {
                await dbPool.query(
                    "UPDATE usuarios SET intentos_fallidos = 0, tiempo_bloqueo = NULL, expiracion_temp_pass = NULL WHERE id_usuario = ?",
                    [user.id_usuario]
                );
            }

            // Generar Token JWT
            const token = jwt.sign(
                { id: user.id_usuario, rol: user.rol, matricula: user.matricula },
                SECRET_KEY,
                { expiresIn: "1h" }
            );

            return res.status(200).json({
                message: "Inicio de sesión exitoso.",
                token: token,
            });
        } else {
            // CONTRASEÑA INCORRECTA
            // Manejar intentos fallidos
            if (user.intentos_fallidos < LIMITE_INTENTOS) {
                const newAttempts = user.intentos_fallidos + 1;
                const tiempoBloqueo = newAttempts >= LIMITE_INTENTOS ? now : null;

                // Si la contraseña es temporal y falló, verificar si expiró
                let expiracionTempPass = user.expiracion_temp_pass;
                if (expiracionTempPass) {
                    const tempPassExpires = new Date(expiracionTempPass);
                    if (now > tempPassExpires) {
                        expiracionTempPass = null;
                    }
                }

                await dbPool.query(
                    "UPDATE usuarios SET intentos_fallidos = ?, tiempo_bloqueo = ?, expiracion_temp_pass = ? WHERE id_usuario = ?",
                    [newAttempts, tiempoBloqueo, expiracionTempPass, user.id_usuario]
                );

                if (newAttempts >= LIMITE_INTENTOS) {
                    return res.status(401).json({
                        message:
                            "Límite de intentos excedido. Su cuenta ha sido bloqueada temporalmente.",
                    });
                } else {
                    const remainingAttempts = LIMITE_INTENTOS - newAttempts;
                    return res.status(401).json({
                        message: `Contraseña incorrecta. Le quedan ${remainingAttempts} intentos.`,
                    });
                }
            } else {
                return res.status(401).json({
                    message: "Matrícula, correo o contraseña incorrectos.",
                });
            }
        }
    } catch (error) {
        console.error("Error en el login:", error);
        return res
            .status(500)
            .json({ message: "Error interno del servidor durante el login." });
    }
});

// [POST] /api/auth/forgot-password
authRouter.post("/forgot-password", async (req, res) => {
    const { correo, matricula } = req.body;

    try {
        // 1. Validar que el usuario exista (por correo O matrícula)
        let users;
        if (correo) {
            [users] = await dbPool.query(
                "SELECT id_usuario, correo FROM usuarios WHERE correo = ?",
                [correo]
            );
        } else if (matricula) {
            [users] = await dbPool.query(
                "SELECT id_usuario, correo FROM usuarios WHERE matricula = ?",
                [matricula]
            );
        } else {
            return res
                .status(400)
                .json({ message: "Debes proporcionar correo o matrícula." });
        }

        if (users.length === 0) {
            return res.status(404).json({
                message: "Este correo electrónico no está registrado en el sistema.",
            });
        }

        // 2. Generar contraseña temporal
        const tempPassword = recoveryService.generateTemporaryPassword();

        // 3. Guardar contraseña temporal usando el correo del usuario encontrado
        const userEmail = users[0].correo;
        await recoveryService.saveTemporaryPassword(
            dbPool,
            userEmail,
            tempPassword
        );

        // 4. Enviar correo
        const sent = await recoveryService.sendRecoveryEmail(
            userEmail,
            tempPassword
        );

        if (!sent) {
            return res.status(500).json({
                message:
                    "No se pudo enviar el correo de recuperación. Revise la configuración SMTP.",
            });
        }

        return res.status(200).json({
            message:
                "Contraseña temporal generada y enviada correctamente al correo (válida por 10 minutos).",
        });
    } catch (error) {
        console.error("Error en recuperación de contraseña:", error);
        return res.status(500).json({ message: "Error interno del servidor." });
    }
});

// --- Conexión de Rutas ---
app.use("/api/auth", authRouter);

// --- Iniciar Conexión y Servidor ---
connectToDb();