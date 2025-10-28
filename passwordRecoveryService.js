// passwordRecoveryService.js

const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");

// Genera una contraseña temporal de 8 caracteres
function generateTemporaryPassword() {
    const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const lowercase = "abcdefghijklmnopqrstuvwxyz";
    const digits = "0123456789";
    const allChars = uppercase + lowercase + digits;

    let password = "";
    // Asegura al menos una mayúscula, una minúscula y un dígito
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += digits[Math.floor(Math.random() * digits.length)];

    for (let i = password.length; i < 8; i++) {
        password += allChars[Math.floor(Math.random() * allChars.length)];
    }

    // Mezcla los caracteres para mayor seguridad
    return password
        .split("")
        .sort(() => 0.5 - Math.random())
        .join("");
}

/**
 * Guarda la contraseña temporal hasheada en la BD, establece la expiración en la nueva columna
 * y reinicia los contadores de bloqueo (intentos_fallidos y tiempo_bloqueo).
 */
async function saveTemporaryPassword(dbPool, email, password) {
    const hashed = await bcrypt.hash(password, 10);
    // La contraseña temporal es válida por 10 minutos
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const [result] = await dbPool.query(
        // La actualización usa la nueva columna `expiracion_temp_pass`
        "UPDATE usuarios SET contraseña = ?, expiracion_temp_pass = ?, intentos_fallidos = 0, tiempo_bloqueo = NULL WHERE correo = ?",
        [hashed, expiresAt, email]
    );

    if (result.affectedRows === 0) {
        throw new Error(
            "Usuario no encontrado para la actualización de contraseña."
        );
    }
}

// Envía la contraseña temporal al correo del usuario usando Nodemailer
async function sendRecoveryEmail(email, temporaryPassword) {
    try {
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: process.env.SMTP_PORT,
            secure: true,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });

        const mailOptions = {
            from: `"Soporte BIBLIOTECA YEAK8" <${process.env.SMTP_USER}>`,
            to: email,
            subject: "Recuperación de Contraseña Temporal (10 minutos)",
            html: `
        <h2>🔐 Contraseña Temporal para BIBLIOTECA YEAK8</h2>
        <p>Hemos recibido tu solicitud de recuperación. Tu <strong>contraseña temporal</strong> es:</p>
        <p style="font-size: 20px; font-weight: bold; background-color: #f0f0f0; padding: 10px; border-radius: 5px; display: inline-block;">${temporaryPassword}</p>
        <p>Utiliza esta contraseña para iniciar sesión. Es válida por <b>10 minutos</b>. Por favor, cámbiala inmediatamente después de iniciar sesión.</p>
      `,
        };

        await transporter.sendMail(mailOptions);
        console.log("✅ Correo de recuperación enviado a:", email);
        return true;
    } catch (error) {
        console.error("❌ Error al enviar el correo:", error.message);
        return false;
    }
}

module.exports = {
    generateTemporaryPassword,
    saveTemporaryPassword,
    sendRecoveryEmail,
};
