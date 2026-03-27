import { useMemo, useState } from "react";
import {
	createUserWithEmailAndPassword,
	signInWithEmailAndPassword,
	updateProfile,
	signOut,
} from "firebase/auth";
import {
	collection,
	deleteDoc,
	doc,
	getDoc,
	getDocs,
	limit,
	query,
	serverTimestamp,
	setDoc,
	where,
} from "firebase/firestore";
import { auth, db, firebaseSetupError } from "./firebase";
import "./App.css";

const AUTH_ERROR_MESSAGES = {
	"auth/email-already-in-use": "האימייל כבר קיים במערכת.",
	"auth/invalid-email": "כתובת האימייל לא תקינה.",
	"auth/weak-password": "הסיסמה חלשה מדי. השתמשו בלפחות 6 תווים.",
	"auth/invalid-credential": "אימייל או סיסמה שגויים.",
	"auth/too-many-requests": "בוצעו יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.",
	"auth/network-request-failed": "בעיית רשת. בדקו חיבור אינטרנט ונסו שוב.",
};

const DEFAULT_ERROR_MESSAGE = "אירעה שגיאה. נסו שוב.";
const MASTER_ADMIN_EMAILS = new Set(["ziadak14@gmail.com", "nournim98@gmail.com"]);
const ROLE_MASTER_ADMIN = "master_admin";
const ROLE_EVENT_ADMIN = "event_admin";
const ROLE_EVENT_USER = "event_user";

function appError(code, message) {
	const error = new Error(message);
	error.code = code;
	return error;
}

function getErrorMessage(error) {
	if (!error?.code) {
		return DEFAULT_ERROR_MESSAGE;
	}

	return AUTH_ERROR_MESSAGES[error.code] ?? DEFAULT_ERROR_MESSAGE;
}

function App() {
	const [mode, setMode] = useState("login");
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [userRole, setUserRole] = useState(null);
	const [displayName, setDisplayName] = useState("");
	const [currentUser, setCurrentUser] = useState(null);
	const [promoteEmail, setPromoteEmail] = useState("");
	const [managedUsers, setManagedUsers] = useState([]);
	const [eventAdminUsers, setEventAdminUsers] = useState([]);
	const [masterEvents, setMasterEvents] = useState([]);
	const [eventAdminEvents, setEventAdminEvents] = useState([]);
	const [eventAssignments, setEventAssignments] = useState([]);
	const [eventUserEvents, setEventUserEvents] = useState([]);
	const [eventName, setEventName] = useState("");
	const [eventDate, setEventDate] = useState("");
	const [eventLocation, setEventLocation] = useState("");
	const [eventDescription, setEventDescription] = useState("");
	const [selectedEventOwnerAdminId, setSelectedEventOwnerAdminId] = useState("");
	const [selectedAssignmentEventId, setSelectedAssignmentEventId] = useState("");
	const [selectedAssignmentUserId, setSelectedAssignmentUserId] = useState("");
	const [selectedEventAdminId, setSelectedEventAdminId] = useState("");
	const [selectedEventUserId, setSelectedEventUserId] = useState("");

	const isRegisterMode = mode === "register";
	const title = useMemo(
		() => (isRegisterMode ? "הרשמה למארגן" : "התחברות למארגן"),
		[isRegisterMode],
	);

	const clearStatus = () => {
		setError("");
		setSuccess("");
	};

	const resetForm = () => {
		setName("");
		setEmail("");
		setPassword("");
		setConfirmPassword("");
	};

	const normalizeEmail = (value) => value.trim().toLowerCase();
	const roleLabel = (role) => {
		if (role === ROLE_MASTER_ADMIN) return "Master Admin";
		if (role === ROLE_EVENT_ADMIN) return "Event Admin";
		return "Event User";
	};

	const ensureConfigured = () => {
		if (!auth || !db) {
			setError("Firebase לא מוגדר עדיין. מלאו את הקובץ .env.");
			return false;
		}

		return true;
	};

	const upsertUserProfile = async (user, fullName) => {
		await setDoc(
			doc(db, "users", user.uid),
			{
				uid: user.uid,
				email: normalizeEmail(user.email ?? ""),
				fullName: fullName || null,
				role: ROLE_EVENT_USER,
				parentMasterAdminId: null,
				parentMasterAdminEmail: null,
				createdAt: serverTimestamp(),
				updatedAt: serverTimestamp(),
			},
			{ merge: true },
		);
	};

	const resolveRole = (profile, userEmail) => {
		const normalizedEmail = normalizeEmail(userEmail ?? "");
		if (MASTER_ADMIN_EMAILS.has(normalizedEmail)) {
			return ROLE_MASTER_ADMIN;
		}

		return profile?.role || ROLE_EVENT_USER;
	};

	const loadMasterUsers = async (masterContext = currentUser) => {
		if (!masterContext || masterContext.role !== ROLE_MASTER_ADMIN) {
			return;
		}

		const usersRef = collection(db, "users");
		const snapshot = await getDocs(usersRef);

		const allUsers = snapshot.docs.map((item) => ({
			id: item.id,
			...item.data(),
		}));

		const filtered = allUsers.filter((item) => {
			const emailValue = normalizeEmail(item.email ?? "");
			if (MASTER_ADMIN_EMAILS.has(emailValue)) {
				return false;
			}

			return (
				item.parentMasterAdminId === masterContext.uid ||
				item.parentMasterAdminId == null
			);
		});

		filtered.sort((a, b) =>
			normalizeEmail(a.email ?? "").localeCompare(normalizeEmail(b.email ?? "")),
		);
		setManagedUsers(filtered);
	};

	const loadEventAdminUsers = async (eventAdminContext = currentUser) => {
		if (!eventAdminContext || eventAdminContext.role !== ROLE_EVENT_ADMIN) {
			return;
		}

		const usersRef = collection(db, "users");
		const q = query(
			usersRef,
			where("parentEventAdminId", "==", eventAdminContext.uid),
			where("role", "==", ROLE_EVENT_USER),
		);
		const snapshot = await getDocs(q);

		const assignedUsers = snapshot.docs.map((item) => ({
			id: item.id,
			...item.data(),
		}));

		assignedUsers.sort((a, b) =>
			normalizeEmail(a.email ?? "").localeCompare(normalizeEmail(b.email ?? "")),
		);
		setEventAdminUsers(assignedUsers);
	};

	const loadEventAdminEvents = async (eventAdminContext = currentUser) => {
		if (!eventAdminContext || eventAdminContext.role !== ROLE_EVENT_ADMIN) {
			return;
		}

		const eventsRef = collection(db, "events");
		const q = query(
			eventsRef,
			where("assignedEventAdminId", "==", eventAdminContext.uid),
		);
		const snapshot = await getDocs(q);

		const events = snapshot.docs.map((item) => ({
			id: item.id,
			...item.data(),
		}));

		events.sort((a, b) => {
			const aDate = a.eventDate || "";
			const bDate = b.eventDate || "";
			return aDate.localeCompare(bDate);
		});
		setEventAdminEvents(events);
	};

	const loadMasterEvents = async (masterContext = currentUser) => {
		if (!masterContext || masterContext.role !== ROLE_MASTER_ADMIN) {
			return;
		}

		const eventsRef = collection(db, "events");
		const q = query(
			eventsRef,
			where("createdByMasterAdminId", "==", masterContext.uid),
		);
		const snapshot = await getDocs(q);

		const events = snapshot.docs.map((item) => ({
			id: item.id,
			...item.data(),
		}));

		events.sort((a, b) => {
			const aDate = a.eventDate || "";
			const bDate = b.eventDate || "";
			return aDate.localeCompare(bDate);
		});
		setMasterEvents(events);
	};

	const loadEventAdminAssignments = async (eventAdminContext = currentUser) => {
		if (!eventAdminContext || eventAdminContext.role !== ROLE_EVENT_ADMIN) {
			return;
		}

		const assignmentsRef = collection(db, "eventAssignments");
		const q = query(
			assignmentsRef,
			where("ownerEventAdminId", "==", eventAdminContext.uid),
		);
		const snapshot = await getDocs(q);

		const assigned = snapshot.docs.map((item) => ({
			id: item.id,
			...item.data(),
		}));

		assigned.sort((a, b) => {
			const aDate = a.eventDate || "";
			const bDate = b.eventDate || "";
			return aDate.localeCompare(bDate);
		});
		setEventAssignments(assigned);
	};

	const loadEventUserEvents = async (userContext = currentUser) => {
		if (!userContext || userContext.role !== ROLE_EVENT_USER) {
			return;
		}

		const assignmentsRef = collection(db, "eventAssignments");
		const q = query(assignmentsRef, where("userId", "==", userContext.uid));
		const snapshot = await getDocs(q);

		const assignedEvents = snapshot.docs.map((item) => ({
			id: item.id,
			...item.data(),
		}));

		assignedEvents.sort((a, b) => {
			const aDate = a.eventDate || "";
			const bDate = b.eventDate || "";
			return aDate.localeCompare(bDate);
		});
		setEventUserEvents(assignedEvents);
	};

	const handleRegister = async () => {
		if (password !== confirmPassword) {
			throw appError("app/password-mismatch", "הסיסמאות לא תואמות.");
		}

		const trimmedName = name.trim();
		const credential = await createUserWithEmailAndPassword(
			auth,
			email.trim(),
			password,
		);

		if (trimmedName) {
			await updateProfile(credential.user, { displayName: trimmedName });
		}

		await upsertUserProfile(credential.user, trimmedName);
		setSuccess("ההרשמה הצליחה. עכשיו אפשר להתחבר.");
		setMode("login");
		setPassword("");
		setConfirmPassword("");
	};

	const handleLogin = async () => {
		const credential = await signInWithEmailAndPassword(
			auth,
			email.trim(),
			password,
		);
		const user = credential.user;

		const userRef = doc(db, "users", user.uid);
		const userSnapshot = await getDoc(userRef);

		if (!userSnapshot.exists()) {
			await upsertUserProfile(user, user.displayName ?? "");
		}

		const profile = userSnapshot.exists()
			? userSnapshot.data()
			: { role: ROLE_EVENT_USER };
		const role = resolveRole(profile, user.email);
		const isAdmin = role === ROLE_MASTER_ADMIN || role === ROLE_EVENT_ADMIN;

		setDisplayName(
			profile.fullName || user.displayName || user.email || "User",
		);
		setCurrentUser({
			uid: user.uid,
			email: normalizeEmail(user.email ?? ""),
			role,
		});
		setUserRole(role);
		setSuccess(isAdmin ? "התחברת כאדמין." : "התחברת בהצלחה.");
		resetForm();

		if (role === ROLE_MASTER_ADMIN) {
			await loadMasterUsers({
				uid: user.uid,
				email: normalizeEmail(user.email ?? ""),
				role,
			});
			await loadMasterEvents({
				uid: user.uid,
				email: normalizeEmail(user.email ?? ""),
				role,
			});
			setEventAdminUsers([]);
			setEventAdminEvents([]);
			setEventAssignments([]);
			setEventUserEvents([]);
		} else if (role === ROLE_EVENT_ADMIN) {
			await loadEventAdminUsers({
				uid: user.uid,
				email: normalizeEmail(user.email ?? ""),
				role,
			});
			await loadEventAdminEvents({
				uid: user.uid,
				email: normalizeEmail(user.email ?? ""),
				role,
			});
			await loadEventAdminAssignments({
				uid: user.uid,
				email: normalizeEmail(user.email ?? ""),
				role,
			});
			setManagedUsers([]);
			setMasterEvents([]);
			setEventUserEvents([]);
		} else {
			setManagedUsers([]);
			setMasterEvents([]);
			setEventAdminUsers([]);
			setEventAdminEvents([]);
			setEventAssignments([]);
			await loadEventUserEvents({
				uid: user.uid,
				email: normalizeEmail(user.email ?? ""),
				role,
			});
		}
	};

	const clearEventForm = () => {
		setEventName("");
		setEventDate("");
		setEventLocation("");
		setEventDescription("");
		setSelectedEventOwnerAdminId("");
	};

	const handlePromoteToEventAdmin = async (event) => {
		event.preventDefault();
		if (!currentUser || currentUser.role !== ROLE_MASTER_ADMIN) {
			setError("רק Master Admin יכול למנות Event Admin.");
			return;
		}

		const targetEmail = normalizeEmail(promoteEmail);
		if (!targetEmail) {
			setError("יש להזין אימייל תקין.");
			return;
		}

		setError("");
		setSuccess("");
		setIsLoading(true);

		try {
			const usersRef = collection(db, "users");
			const q = query(usersRef, where("email", "==", targetEmail), limit(1));
			const snapshot = await getDocs(q);

			if (snapshot.empty) {
				throw appError("app/user-not-found", "המשתמש לא נמצא. בקשו ממנו להירשם קודם.");
			}

			const targetDoc = snapshot.docs[0];
			await setDoc(
				doc(db, "users", targetDoc.id),
				{
					role: ROLE_EVENT_ADMIN,
					parentMasterAdminId: currentUser.uid,
					parentMasterAdminEmail: currentUser.email,
					parentEventAdminId: null,
					parentEventAdminEmail: null,
					updatedAt: serverTimestamp(),
				},
				{ merge: true },
			);

			setPromoteEmail("");
			setSuccess(`המשתמש ${targetEmail} מונה ל-Event Admin.`);
			await loadMasterUsers();
		} catch (promoteError) {
			setError(promoteError.message || DEFAULT_ERROR_MESSAGE);
		} finally {
			setIsLoading(false);
		}
	};

	const handleDemoteEventAdmin = async (userItem) => {
		if (!currentUser || currentUser.role !== ROLE_MASTER_ADMIN) {
			setError("רק Master Admin יכול לשנות הרשאות.");
			return;
		}

		setError("");
		setSuccess("");
		setIsLoading(true);

		try {
			await setDoc(
				doc(db, "users", userItem.id),
				{
					role: ROLE_EVENT_USER,
					parentMasterAdminId: currentUser.uid,
					parentMasterAdminEmail: currentUser.email,
					parentEventAdminId: null,
					parentEventAdminEmail: null,
					updatedAt: serverTimestamp(),
				},
				{ merge: true },
			);

			setSuccess(`המשתמש ${userItem.email} הורד ל-Event User.`);
			await loadMasterUsers();
		} catch (demoteError) {
			setError(demoteError.message || DEFAULT_ERROR_MESSAGE);
		} finally {
			setIsLoading(false);
		}
	};

	const handleAssignEventUser = async (event) => {
		event.preventDefault();
		if (!currentUser || currentUser.role !== ROLE_MASTER_ADMIN) {
			setError("רק Master Admin יכול לשייך משתמשים.");
			return;
		}

		if (!selectedEventAdminId || !selectedEventUserId) {
			setError("בחרו Event Admin ומשתמש לשיוך.");
			return;
		}

		const eventAdmin = managedUsers.find((item) => item.id === selectedEventAdminId);
		const eventUser = managedUsers.find((item) => item.id === selectedEventUserId);

		if (!eventAdmin || eventAdmin.role !== ROLE_EVENT_ADMIN) {
			setError("האדמין שנבחר לא תקין.");
			return;
		}

		if (!eventUser || eventUser.role !== ROLE_EVENT_USER) {
			setError("יש לבחור משתמש מסוג Event User.");
			return;
		}

		setError("");
		setSuccess("");
		setIsLoading(true);

		try {
			await setDoc(
				doc(db, "users", eventUser.id),
				{
					role: ROLE_EVENT_USER,
					parentMasterAdminId: currentUser.uid,
					parentMasterAdminEmail: currentUser.email,
					parentEventAdminId: eventAdmin.id,
					parentEventAdminEmail: normalizeEmail(eventAdmin.email ?? ""),
					updatedAt: serverTimestamp(),
				},
				{ merge: true },
			);

			setSuccess(`המשתמש ${eventUser.email} שויך ל-${eventAdmin.email}.`);
			setSelectedEventUserId("");
			await loadMasterUsers();
		} catch (assignError) {
			setError(assignError.message || DEFAULT_ERROR_MESSAGE);
		} finally {
			setIsLoading(false);
		}
	};

	const handleSaveEvent = async (event) => {
		event.preventDefault();
		if (!currentUser || currentUser.role !== ROLE_MASTER_ADMIN) {
			setError("רק Master Admin יכול ליצור אירועים.");
			return;
		}

		if (!eventName.trim() || !eventDate || !selectedEventOwnerAdminId) {
			setError("יש להזין שם אירוע, תאריך, ולבחור Event Admin.");
			return;
		}

		const selectedAdmin = managedUsers.find(
			(item) => item.id === selectedEventOwnerAdminId && item.role === ROLE_EVENT_ADMIN,
		);
		if (!selectedAdmin) {
			setError("האדמין שנבחר לא תקין.");
			return;
		}

		setError("");
		setSuccess("");
		setIsLoading(true);

		try {
			const newEventRef = doc(collection(db, "events"));
			await setDoc(newEventRef, {
				name: eventName.trim(),
				eventDate,
				location: eventLocation.trim() || null,
				description: eventDescription.trim() || null,
				assignedEventAdminId: selectedAdmin.id,
				assignedEventAdminEmail: normalizeEmail(selectedAdmin.email ?? ""),
				assignedEventAdminName: selectedAdmin.fullName || null,
				createdByMasterAdminId: currentUser.uid,
				createdByMasterAdminEmail: currentUser.email,
				createdAt: serverTimestamp(),
				updatedAt: serverTimestamp(),
			});

			clearEventForm();
			setSuccess("האירוע נוצר ושויך ל-Event Admin.");
			await loadMasterEvents();
		} catch (saveError) {
			setError(saveError.message || DEFAULT_ERROR_MESSAGE);
		} finally {
			setIsLoading(false);
		}
	};

	const handleAssignUserToEvent = async (event) => {
		event.preventDefault();
		if (!currentUser || currentUser.role !== ROLE_EVENT_ADMIN) {
			setError("רק Event Admin יכול לשייך משתמשים לאירוע.");
			return;
		}

		if (!selectedAssignmentEventId || !selectedAssignmentUserId) {
			setError("בחרו אירוע ומשתמש.");
			return;
		}

		const targetEvent = eventAdminEvents.find((item) => item.id === selectedAssignmentEventId);
		const targetUser = eventAdminUsers.find((item) => item.id === selectedAssignmentUserId);
		if (!targetEvent || !targetUser) {
			setError("אירוע או משתמש לא תקינים.");
			return;
		}

		setError("");
		setSuccess("");
		setIsLoading(true);

		try {
			const assignmentsRef = collection(db, "eventAssignments");
			const duplicateQuery = query(
				assignmentsRef,
				where("eventId", "==", targetEvent.id),
				where("userId", "==", targetUser.id),
				limit(1),
			);
			const duplicateSnapshot = await getDocs(duplicateQuery);
			if (!duplicateSnapshot.empty) {
				setError("המשתמש כבר משויך לאירוע הזה.");
				return;
			}

			const assignmentRef = doc(collection(db, "eventAssignments"));
			await setDoc(assignmentRef, {
				eventId: targetEvent.id,
				eventName: targetEvent.name,
				eventDate: targetEvent.eventDate,
				eventLocation: targetEvent.location || null,
				eventDescription: targetEvent.description || null,
				userId: targetUser.id,
				userEmail: normalizeEmail(targetUser.email ?? ""),
				userFullName: targetUser.fullName || null,
				ownerEventAdminId: currentUser.uid,
				ownerEventAdminEmail: currentUser.email,
				createdAt: serverTimestamp(),
				updatedAt: serverTimestamp(),
			});

			setSelectedAssignmentUserId("");
			setSuccess("המשתמש שויך לאירוע בהצלחה.");
			await loadEventAdminAssignments();
		} catch (assignError) {
			setError(assignError.message || DEFAULT_ERROR_MESSAGE);
		} finally {
			setIsLoading(false);
		}
	};

	const handleRemoveAssignment = async (assignmentId) => {
		if (!currentUser || currentUser.role !== ROLE_EVENT_ADMIN) {
			setError("רק Event Admin יכול להסיר שיוך.");
			return;
		}

		setError("");
		setSuccess("");
		setIsLoading(true);

		try {
			await deleteDoc(doc(db, "eventAssignments", assignmentId));
			setSuccess("שיוך המשתמש הוסר מהאירוע.");
			await loadEventAdminAssignments();
		} catch (removeError) {
			setError(removeError.message || DEFAULT_ERROR_MESSAGE);
		} finally {
			setIsLoading(false);
		}
	};

	const handleLogout = async () => {
		if (!auth) {
			return;
		}

		await signOut(auth);
		setUserRole(null);
		setDisplayName("");
		setCurrentUser(null);
		setManagedUsers([]);
		setMasterEvents([]);
		setEventAdminUsers([]);
		setEventAdminEvents([]);
		setEventAssignments([]);
		setEventUserEvents([]);
		setPromoteEmail("");
		setSelectedAssignmentEventId("");
		setSelectedAssignmentUserId("");
		setSelectedEventAdminId("");
		setSelectedEventUserId("");
		clearEventForm();
		setSuccess("");
		setError("");
	};

	const onSubmit = async (event) => {
		event.preventDefault();

		if (!ensureConfigured()) {
			return;
		}

		clearStatus();
		setIsLoading(true);

		try {
			if (isRegisterMode) {
				await handleRegister();
			} else {
				await handleLogin();
			}
		} catch (caughtError) {
			if (caughtError?.code === "app/password-mismatch") {
				setError(caughtError.message);
			} else {
				setError(getErrorMessage(caughtError));
			}
		} finally {
			setIsLoading(false);
		}
	};

	if (userRole) {
		const isAdmin = userRole === ROLE_MASTER_ADMIN || userRole === ROLE_EVENT_ADMIN;
		const eventAdmins = managedUsers.filter((item) => item.role === ROLE_EVENT_ADMIN);
		const eventUsers = managedUsers.filter((item) => item.role === ROLE_EVENT_USER);
		return (
			<main className="page">
				<section className="card dashboard" dir="rtl">
					<p className="badge">Momento</p>
					<h1>{isAdmin ? "Admin Panel" : "Home Page"}</h1>
					<p className="subtitle">שלום {displayName}</p>
					<p className="success">
						{isAdmin
							? userRole === ROLE_MASTER_ADMIN
								? "אתה מחובר כ-Master Admin."
								: "אתה מחובר כ-Event Admin."
							: "התחברת כמשתמש רגיל ללא הרשאות מנהל."}
					</p>

					{userRole === ROLE_MASTER_ADMIN && (
						<>
							<div className="users-list">
								<h3>יצירת אירוע ושיוך ל-Event Admin</h3>
								<form className="promote-form" onSubmit={handleSaveEvent}>
									<input
										type="text"
										placeholder="שם האירוע"
										value={eventName}
										onChange={(event) => setEventName(event.target.value)}
										required
									/>
									<input
										type="date"
										value={eventDate}
										onChange={(event) => setEventDate(event.target.value)}
										required
									/>
									<input
										type="text"
										placeholder="מיקום האירוע (אופציונלי)"
										value={eventLocation}
										onChange={(event) => setEventLocation(event.target.value)}
									/>
									<input
										type="text"
										placeholder="תיאור קצר (אופציונלי)"
										value={eventDescription}
										onChange={(event) => setEventDescription(event.target.value)}
									/>
									<select
										value={selectedEventOwnerAdminId}
										onChange={(event) => setSelectedEventOwnerAdminId(event.target.value)}
										required
									>
										<option value="">בחרו Event Admin לאירוע</option>
										{eventAdmins.map((item) => (
											<option key={item.id} value={item.id}>
												{item.fullName || item.email}
											</option>
										))}
									</select>
									<button type="submit" className="submit-button" disabled={isLoading}>
										{isLoading ? "שומר..." : "צור אירוע"}
									</button>
								</form>
								{masterEvents.length === 0 && <p>עדיין לא יצרת אירועים.</p>}
								{masterEvents.map((item) => (
									<div key={item.id} className="user-row">
										<div>
											<strong>{item.name}</strong>
											<div className="row-meta">
												{item.eventDate}
												{item.location ? ` | ${item.location}` : ""}
												{item.assignedEventAdminEmail
													? ` | Event Admin: ${item.assignedEventAdminEmail}`
													: ""}
											</div>
										</div>
									</div>
								))}
							</div>

							<form className="promote-form" onSubmit={handlePromoteToEventAdmin}>
								<label htmlFor="promoteEmail">מינוי Event Admin (לפי אימייל)</label>
								<input
									id="promoteEmail"
									type="email"
									placeholder="event-admin@example.com"
									value={promoteEmail}
									onChange={(event) => setPromoteEmail(event.target.value)}
									required
								/>
								<button type="submit" className="submit-button" disabled={isLoading}>
									{isLoading ? "מעדכן..." : "מנה ל-Event Admin"}
								</button>
							</form>

							<form className="promote-form" onSubmit={handleAssignEventUser}>
								<label htmlFor="eventAdminSelect">שיוך Event User ל-Event Admin</label>
								<select
									id="eventAdminSelect"
									value={selectedEventAdminId}
									onChange={(event) => setSelectedEventAdminId(event.target.value)}
									required
								>
									<option value="">בחרו Event Admin</option>
									{eventAdmins.map((item) => (
										<option key={item.id} value={item.id}>
											{item.fullName || item.email}
										</option>
									))}
								</select>
								<select
									value={selectedEventUserId}
									onChange={(event) => setSelectedEventUserId(event.target.value)}
									required
								>
									<option value="">בחרו Event User</option>
									{eventUsers.map((item) => (
										<option key={item.id} value={item.id}>
											{item.fullName || item.email}
										</option>
									))}
								</select>
								<button type="submit" className="submit-button" disabled={isLoading}>
									{isLoading ? "מעדכן..." : "שייך משתמש"}
								</button>
							</form>

							<div className="users-list">
								<h3>משתמשים תחת Master Admin</h3>
								{managedUsers.length === 0 && <p>אין משתמשים להצגה.</p>}
								{managedUsers.map((item) => (
									<div key={item.id} className="user-row">
										<div>
											<strong>{item.fullName || item.email}</strong>
											<div className="row-meta">
												{item.email} | {roleLabel(item.role)}{" "}
												{item.parentEventAdminEmail
													? `| תחת ${item.parentEventAdminEmail}`
													: ""}
											</div>
										</div>
										{item.role === ROLE_EVENT_ADMIN && (
											<button
												type="button"
												className="tab"
												onClick={() => handleDemoteEventAdmin(item)}
												disabled={isLoading}
											>
												הורד ל-Event User
											</button>
										)}
									</div>
								))}
							</div>
						</>
					)}

					{userRole === ROLE_EVENT_ADMIN && (
						<>
							<div className="users-list">
								<h3>האירועים שהוקצו אליך</h3>
								{eventAdminEvents.length === 0 && <p>עדיין לא הוקצו לך אירועים.</p>}
								{eventAdminEvents.map((item) => (
									<div key={item.id} className="user-row">
										<div>
											<strong>{item.name}</strong>
											<div className="row-meta">
												{item.eventDate}
												{item.location ? ` | ${item.location}` : ""}
											</div>
										</div>
									</div>
								))}
							</div>

							<div className="users-list">
								<h3>שיוך משתמשים לאירועים</h3>
								<form className="promote-form" onSubmit={handleAssignUserToEvent}>
									<select
										value={selectedAssignmentEventId}
										onChange={(event) => setSelectedAssignmentEventId(event.target.value)}
										required
									>
										<option value="">בחרו אירוע</option>
										{eventAdminEvents.map((item) => (
											<option key={item.id} value={item.id}>
												{item.name}
											</option>
										))}
									</select>
									<select
										value={selectedAssignmentUserId}
										onChange={(event) => setSelectedAssignmentUserId(event.target.value)}
										required
									>
										<option value="">בחרו Event User</option>
										{eventAdminUsers.map((item) => (
											<option key={item.id} value={item.id}>
												{item.fullName || item.email}
											</option>
										))}
									</select>
									<button type="submit" className="submit-button" disabled={isLoading}>
										{isLoading ? "משייך..." : "שייך משתמש לאירוע"}
									</button>
								</form>

								{eventAssignments.length === 0 && <p>עדיין אין שיוכים.</p>}
								{eventAssignments.map((item) => (
									<div key={item.id} className="user-row">
										<div>
											<strong>{item.eventName}</strong>
											<div className="row-meta">
												{item.userFullName || item.userEmail}
												{item.eventDate ? ` | ${item.eventDate}` : ""}
											</div>
										</div>
										<button
											type="button"
											className="tab"
											onClick={() => handleRemoveAssignment(item.id)}
											disabled={isLoading}
										>
											הסר שיוך
										</button>
									</div>
								))}
							</div>

							<div className="users-list">
								<h3>Event Users תחתייך</h3>
								<p className="row-meta">
									סה״כ משתמשים משויכים: {eventAdminUsers.length}
								</p>
								{eventAdminUsers.length === 0 && (
									<p>עדיין לא שויכו אליך Event Users.</p>
								)}
								{eventAdminUsers.map((item) => (
									<div key={item.id} className="user-row">
										<div>
											<strong>{item.fullName || item.email}</strong>
											<div className="row-meta">{item.email} | Event User</div>
										</div>
									</div>
								))}
							</div>
						</>
					)}

					{userRole === ROLE_EVENT_USER && (
						<div className="users-list">
							<h3>האירועים שלי</h3>
							{eventUserEvents.length === 0 && <p>עדיין לא שויכת לאירועים.</p>}
							{eventUserEvents.map((item) => (
								<div key={item.id} className="user-row">
									<div>
										<strong>{item.eventName}</strong>
										<div className="row-meta">
											{item.eventDate || "ללא תאריך"}
											{item.eventLocation ? ` | ${item.eventLocation}` : ""}
										</div>
										{item.eventDescription && (
											<div className="row-meta">{item.eventDescription}</div>
										)}
									</div>
								</div>
							))}
						</div>
					)}

					<button
						type="button"
						className="submit-button"
						onClick={handleLogout}
					>
						התנתקות
					</button>
				</section>
			</main>
		);
	}

	return (
		<main className="page">
			<section className="card" dir="rtl">
				<p className="badge">Momento</p>
				<h1>{title}</h1>
				<p className="subtitle">
					{isRegisterMode ? "יצירת חשבון מארגן חדש" : "התחברות לחשבון"}
				</p>

				<div className="switcher">
					<button
						type="button"
						className={!isRegisterMode ? "tab active" : "tab"}
						onClick={() => {
							setMode("login");
							clearStatus();
						}}
						disabled={isLoading}
					>
						התחברות
					</button>
					<button
						type="button"
						className={isRegisterMode ? "tab active" : "tab"}
						onClick={() => {
							setMode("register");
							clearStatus();
						}}
						disabled={isLoading}
					>
						הרשמה
					</button>
				</div>

				<form onSubmit={onSubmit} className="login-form">
					{isRegisterMode && (
						<>
							<label htmlFor="name">שם מלא</label>
							<input
								id="name"
								type="text"
								placeholder="השם שלך"
								value={name}
								onChange={(event) => setName(event.target.value)}
								required
								autoFocus
							/>
						</>
					)}

					<label htmlFor="email">אימייל</label>
					<input
						id="email"
						type="email"
						placeholder="name@example.com"
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						required
						autoFocus={!isRegisterMode}
					/>

					<label htmlFor="password">סיסמה</label>
					<input
						id="password"
						type="password"
						placeholder="********"
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						required
					/>

					{isRegisterMode && (
						<>
							<label htmlFor="confirmPassword">אימות סיסמה</label>
							<input
								id="confirmPassword"
								type="password"
								placeholder="********"
								value={confirmPassword}
								onChange={(event) => setConfirmPassword(event.target.value)}
								required
							/>
						</>
					)}

					<button type="submit" className="submit-button" disabled={isLoading}>
						{isLoading ? "טוען..." : isRegisterMode ? "יצירת חשבון" : "התחברות"}
					</button>
				</form>

				{firebaseSetupError && <p className="warning">{firebaseSetupError}</p>}
				{error && <p className="error">{error}</p>}
				{success && <p className="success">{success}</p>}
			</section>
		</main>
	);
}

export default App;
